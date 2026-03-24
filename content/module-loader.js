// ============================================================
// Ccofolia Extension - Module Loader
// 내장 + 사용자 데이터/스크립트 모듈(JSON)을 로드하여 설정/트리거/코드를 코어에 등록
//
// 모듈 JSON 포맷은 MODULE_DEV_GUIDE.md 참조.
// 내장 모듈은 modules/ 폴더에 위치하며 chrome.runtime.getURL로 접근.
// 사용자 모듈은 chrome.storage.local['bwbr_user_modules']에 저장.
// 활성/비활성 상태는 chrome.storage.sync['bwbr_modules']에 저장.
//
// 공개 API:
//   window.BWBR_ModuleLoader
//     .loadAll()                       → Promise  (모듈 로드 + 상태 적용)
//     .getModules()                    → Array<{id, name, ..., enabled, builtin, user}>
//     .isEnabled(id)                   → boolean
//     .setEnabled(id, bool)            → Promise  (상태 변경 + 저장)
//     .getConfigDefaults(ns)           → object|null  (특정 네임스페이스의 기본값)
//     .getTriggers()                   → Array  (활성 모듈의 트리거 합산)
//     .validateModule(json)            → {valid, errors}  (매니페스트 검증)
//     .addUserModule(json)             → Promise<{success, error?}>  (사용자 모듈 추가)
//     .removeUserModule(id)            → Promise<{success, error?}>  (사용자 모듈 삭제)
//     .exportModule(id)                → string|null  (JSON 문자열 내보내기)
//     .getDependencyWarnings()         → Array<{moduleId, missing}>
// ============================================================

(function () {
  'use strict';

  // ── 내장 모듈 경로 (Chrome 확장은 디렉토리 열거 불가 → 하드코딩) ──
  var BUILTIN_MODULES = [
    'modules/branch-world/manifest.json',
    'modules/triggers/manifest.json',
    'modules/multi-select/manifest.json',
    'modules/placement/manifest.json'
  ];

  var STORAGE_KEY = 'bwbr_modules';       // { moduleId: boolean } — chrome.storage.sync
  var USER_MODULES_KEY = 'bwbr_user_modules'; // { moduleId: manifestJSON } — chrome.storage.local

  // 모듈 매니페스트 필수 필드
  var REQUIRED_FIELDS = ['id', 'name', 'version', 'type'];

  function LOG() {
    if (window._BWBR_DEBUG) {
      var args = ['[CE Module]'].concat(Array.prototype.slice.call(arguments));
      console.log.apply(console, args);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  ModuleLoader 클래스
  // ══════════════════════════════════════════════════════════

  function ModuleLoader() {
    this._modules = [];           // 로드된 모듈 매니페스트 배열
    this._enabledState = {};      // { id: boolean }
    this._configNamespaces = {};  // { namespace: defaults } — 활성 모듈만
    this._triggers = [];          // 활성 모듈의 트리거 합산
    this._loaded = false;
    this._depWarnings = [];       // 의존성 경고 [{moduleId, missing:[]}]
  }

  // ── loadAll: 내장 + 사용자 모듈 전부 로드 + 활성 상태 적용 ─

  ModuleLoader.prototype.loadAll = function () {
    var self = this;
    return new Promise(function (resolve) {
      // 1. chrome.storage.sync에서 활성 상태 읽기
      try {
        chrome.storage.sync.get(STORAGE_KEY, function (result) {
          if (chrome.runtime.lastError) {
            LOG('활성 상태 로드 실패:', chrome.runtime.lastError.message);
            self._enabledState = {};
          } else {
            self._enabledState = (result && result[STORAGE_KEY]) || {};
          }
          // 2. 내장 모듈 로드 → 사용자 모듈 로드 (순차)
          self._loadBuiltinModules().then(function () {
            return self._loadUserModules();
          }).then(function () {
            self._loaded = true;
            resolve();
          });
        });
      } catch (e) {
        LOG('storage 접근 실패:', e.message);
        self._enabledState = {};
        self._loadBuiltinModules().then(function () {
          return self._loadUserModules();
        }).then(function () {
          self._loaded = true;
          resolve();
        });
      }
    });
  };

  // ── 내부: 내장 모듈 로드 ────────────────────────────────────

  ModuleLoader.prototype._loadBuiltinModules = function () {
    var self = this;

    var promises = BUILTIN_MODULES.map(function (path) {
      return self._fetchModule(path);
    });

    return Promise.all(promises).then(function (results) {
      results.forEach(function (mod) {
        if (!mod) return;
        self._registerModule(mod);
      });
    }).catch(function (e) {
      LOG('내장 모듈 로드 중 오류:', e.message);
    });
  };

  // ── 내부: 사용자 모듈 로드 (chrome.storage.local) ─────────

  ModuleLoader.prototype._loadUserModules = function () {
    var self = this;
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(USER_MODULES_KEY, function (result) {
          if (chrome.runtime.lastError) {
            LOG('사용자 모듈 로드 실패:', chrome.runtime.lastError.message);
            resolve();
            return;
          }
          var userMods = (result && result[USER_MODULES_KEY]) || {};
          var ids = Object.keys(userMods);
          LOG('사용자 모듈:', ids.length, '개 발견');

          ids.forEach(function (id) {
            try {
              var mod = JSON.parse(JSON.stringify(userMods[id]));
              // 중복 ID 방지 (내장 모듈과 충돌 시 스킵)
              if (self._modules.some(function (m) { return m.id === mod.id; })) {
                LOG('사용자 모듈 ID 충돌 (내장과 중복), 스킵:', mod.id);
                return;
              }
              mod._builtin = false;
              mod._user = true;
              self._registerModule(mod);
            } catch (e) {
              LOG('사용자 모듈 파싱 오류 (' + id + '):', e.message);
            }
          });

          // 의존성 검사 + 적용 + 스크립트 실행 + BWBR_DEFAULTS 재구성
          self._applyAllWithDeps();
          self._saveEnabledState();

          LOG('전체 모듈 로드 완료:', self._modules.length, '개,',
              'active:', self._modules.filter(function (m) { return self._enabledState[m.id]; }).length);
          if (self._depWarnings.length > 0) {
            LOG('⚠️ 의존성 경고:', self._depWarnings.length, '건');
          }
          resolve();
        });
      } catch (e) {
        LOG('사용자 모듈 storage 접근 실패:', e.message);
        self._applyAllWithDeps();
        self._saveEnabledState();
        resolve();
      }
    });
  };

  // ── 내부: 모듈 등록 (내장/사용자 공통) ────────────────────

  ModuleLoader.prototype._registerModule = function (mod) {
    this._modules.push(mod);

    // 최초 로드 시 기본 활성
    if (this._enabledState[mod.id] === undefined) {
      this._enabledState[mod.id] = true;
    }

    // 활성 모듈만 적용 (의존성 검사는 _applyAllWithDeps에서 일괄 처리)
    // 여기서는 단순 등록만, 적용은 _applyAllWithDeps()에서
  };

  // ── 내부: 단일 모듈 JSON fetch ────────────────────────────

  ModuleLoader.prototype._fetchModule = function (path) {
    try {
      var url = chrome.runtime.getURL(path);
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (json) {
        json._path = path;       // 내부용 경로 기록
        json._builtin = true;    // 내장 모듈 플래그
        LOG('모듈 로드:', json.id, '(' + json.name + ')');
        return json;
      }).catch(function (e) {
        console.warn('[CE Module] 모듈 로드 실패 (' + path + '):', e.message);
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  };

  // ── 내부: 모듈 적용 (설정 + 트리거 + 스크립트 등록) ──────────────────

  ModuleLoader.prototype._applyModule = function (mod) {
    // config.defaults → 네임스페이스별 설정 등록
    if (mod.config && mod.config.namespace && mod.config.defaults) {
      var ns = mod.config.namespace;
      this._configNamespaces[ns] = JSON.parse(JSON.stringify(mod.config.defaults));

      // 특수 처리: 'combat' 네임스페이스 → window.BWBR_COMBAT_DEFAULTS
      if (ns === 'combat') {
        window.BWBR_COMBAT_DEFAULTS = JSON.parse(JSON.stringify(mod.config.defaults));
        window.BWBR_COMBAT_KEYS = Object.keys(mod.config.defaults);
      }
    }

    // triggers[] → 합산 배열에 추가
    if (mod.triggers && Array.isArray(mod.triggers)) {
      this._triggers = this._triggers.concat(
        JSON.parse(JSON.stringify(mod.triggers))
      );
    }

    // script 모듈 → 스크립트 실행 (MAIN world 삽입)
    if (mod.type === 'script' && mod.script) {
      this._executeScript(mod);
    }
  };

  // ── 내부: 의존성 검사 + 적용 (모듈 등록 후 일괄 호출) ───

  ModuleLoader.prototype._applyAllWithDeps = function () {
    var self = this;
    this._depWarnings = [];
    this._configNamespaces = {};
    this._triggers = [];

    // 활성 모듈 목록
    var allIds = {};
    this._modules.forEach(function (m) { allIds[m.id] = true; });
    var enabledIds = {};
    this._modules.forEach(function (m) {
      if (self._enabledState[m.id]) enabledIds[m.id] = true;
    });

    // 위상 정렬 (dependencies 기반)
    var sorted = this._topoSort(this._modules);

    sorted.forEach(function (mod) {
      if (!self._enabledState[mod.id]) return;

      // 의존성 검사
      if (mod.dependencies && Array.isArray(mod.dependencies)) {
        var missing = mod.dependencies.filter(function (depId) {
          return !allIds[depId] || !enabledIds[depId];
        });
        if (missing.length > 0) {
          self._depWarnings.push({ moduleId: mod.id, moduleName: mod.name || mod.id, missing: missing });
          LOG('⚠️ 모듈 "' + mod.id + '" 의존성 미충족:', missing.join(', '),
              '→ 해당 모듈 기능 제한될 수 있음');
        }
      }

      // 의존성 미충족이어도 적용은 시도 (경고만 표시, 완전 차단 안 함)
      self._applyModule(mod);
    });

    // BWBR_DEFAULTS 재구성
    this._rebuildDefaults();
  };

  // ── 내부: 위상 정렬 (Kahn's algorithm) ────────────────────

  ModuleLoader.prototype._topoSort = function (modules) {
    var idToMod = {};
    var inDegree = {};
    var graph = {}; // depId -> [modules that depend on it]

    modules.forEach(function (m) {
      idToMod[m.id] = m;
      inDegree[m.id] = 0;
      graph[m.id] = [];
    });

    // 간선 구성: dep -> module (dep가 먼저 로드되어야 함)
    modules.forEach(function (m) {
      if (m.dependencies && Array.isArray(m.dependencies)) {
        m.dependencies.forEach(function (depId) {
          if (idToMod[depId]) {
            graph[depId].push(m.id);
            inDegree[m.id]++;
          }
        });
      }
    });

    // BFS
    var queue = [];
    var result = [];
    for (var id in inDegree) {
      if (inDegree[id] === 0) queue.push(id);
    }
    while (queue.length > 0) {
      var current = queue.shift();
      if (idToMod[current]) result.push(idToMod[current]);
      (graph[current] || []).forEach(function (next) {
        inDegree[next]--;
        if (inDegree[next] === 0) queue.push(next);
      });
    }

    // 순환 의존성 방지: 정렬에 포함되지 않은 모듈 추가
    if (result.length < modules.length) {
      modules.forEach(function (m) {
        if (!result.some(function (r) { return r.id === m.id; })) {
          LOG('⚠️ 순환 의존성 감지, 순서 무시:', m.id);
          result.push(m);
        }
      });
    }

    return result;
  };

  // ── 내부: 스크립트 모듈 실행 (MAIN world 삽입) ────────────

  ModuleLoader.prototype._executeScript = function (mod) {
    if (!mod.script) return;

    var code = '';
    var world = (mod.script.world || 'main').toLowerCase();

    if (mod.script.code) {
      code = mod.script.code;
    } else if (mod.script.file && mod._builtin) {
      // 내장 모듈: 파일 경로에서 로드 (web_accessible_resources 필요)
      var basePath = mod._path ? mod._path.replace(/\/[^/]+$/, '/') : '';
      var scriptUrl = chrome.runtime.getURL(basePath + mod.script.file);
      LOG('스크립트 모듈 파일 로드:', mod.id, scriptUrl, '(world:', world, ')');
      if (world === 'isolated') {
        // ISOLATED world: dynamic import (content script 컨텍스트)
        import(scriptUrl).then(function () {
          LOG('스크립트 모듈 실행 완료 (ISOLATED file):', mod.id);
        }).catch(function (e) {
          LOG('스크립트 모듈 실행 오류 (ISOLATED file):', mod.id, e.message);
        });
      } else {
        // MAIN world: <script src> 로 삽입
        var scriptEl = document.createElement('script');
        scriptEl.src = scriptUrl;
        scriptEl.dataset.bwbrModule = mod.id;
        (document.head || document.documentElement).appendChild(scriptEl);
      }
      return;
    } else {
      LOG('스크립트 모듈 코드 없음:', mod.id);
      return;
    }

    if (world === 'main') {
      // MAIN world: blob URL → <script src> 로 삽입 (인라인은 CSP에 차단됨)
      LOG('스크립트 모듈 실행 (MAIN):', mod.id);
      try {
        var wrapper = '(function(){"use strict";\n/* BWBR Module: ' + mod.id + ' */\n' + code + '\n})();';
        var blob = new Blob([wrapper], { type: 'text/javascript' });
        var blobUrl = URL.createObjectURL(blob);
        var el = document.createElement('script');
        el.src = blobUrl;
        el.dataset.bwbrModule = mod.id;
        el.onload = function () { URL.revokeObjectURL(blobUrl); };
        el.onerror = function () {
          URL.revokeObjectURL(blobUrl);
          LOG('스크립트 모듈 실행 오류 (MAIN):', mod.id);
        };
        (document.head || document.documentElement).appendChild(el);
      } catch (e) {
        LOG('스크립트 모듈 실행 오류 (MAIN):', mod.id, e.message);
      }
    } else if (world === 'isolated') {
      // ISOLATED world: Function constructor는 MV3에서 차단됨
      // blob URL + dynamic import 사용
      LOG('스크립트 모듈 실행 (ISOLATED):', mod.id);
      try {
        var blob = new Blob(
          ['/* BWBR Module: ' + mod.id + ' */\n' + code],
          { type: 'text/javascript' }
        );
        var url = URL.createObjectURL(blob);
        import(url).then(function () {
          URL.revokeObjectURL(url);
          LOG('스크립트 모듈 실행 완료 (ISOLATED):', mod.id);
        }).catch(function (e) {
          URL.revokeObjectURL(url);
          LOG('스크립트 모듈 실행 오류 (ISOLATED):', mod.id, e.message);
        });
      } catch (e) {
        LOG('스크립트 모듈 실행 오류 (ISOLATED):', mod.id, e.message);
      }
    } else {
      LOG('알 수 없는 스크립트 world:', world, '(', mod.id, ')');
    }
  };

  // ── 내부: 모듈 적용 해제 ──────────────────────────────────

  ModuleLoader.prototype._unapplyModule = function (mod) {
    // 설정 제거
    if (mod.config && mod.config.namespace) {
      delete this._configNamespaces[mod.config.namespace];
      if (mod.config.namespace === 'combat') {
        window.BWBR_COMBAT_DEFAULTS = {};
        window.BWBR_COMBAT_KEYS = [];
      }
    }

    // 트리거 재구성 (활성 모듈만)
    this._rebuildTriggers();
  };

  // ── 내부: 트리거 재구성 ───────────────────────────────────

  ModuleLoader.prototype._rebuildTriggers = function () {
    var self = this;
    this._triggers = [];
    this._modules.forEach(function (mod) {
      if (self._enabledState[mod.id] && mod.triggers && Array.isArray(mod.triggers)) {
        self._triggers = self._triggers.concat(
          JSON.parse(JSON.stringify(mod.triggers))
        );
      }
    });
  };

  // ── 내부: BWBR_DEFAULTS 재구성 ────────────────────────────

  ModuleLoader.prototype._rebuildDefaults = function () {
    var merged = JSON.parse(JSON.stringify(window.BWBR_CORE_DEFAULTS || {}));
    for (var ns in this._configNamespaces) {
      var nsDefaults = JSON.parse(JSON.stringify(this._configNamespaces[ns]));
      Object.assign(merged, nsDefaults);
    }
    window.BWBR_DEFAULTS = merged;
  };

  // ── 내부: 활성 상태 저장 ──────────────────────────────────

  ModuleLoader.prototype._saveEnabledState = function () {
    var data = {};
    data[STORAGE_KEY] = this._enabledState;
    try {
      chrome.storage.sync.set(data);
    } catch (e) {
      LOG('활성 상태 저장 실패:', e.message);
    }
  };

  // ══════════════════════════════════════════════════════════
  //  공개 API
  // ══════════════════════════════════════════════════════════

  /**
   * 로드된 모듈 목록 반환 (UI 표시용)
   * @returns {Array<{id, name, description, version, type, tags, enabled, builtin}>}
   */
  ModuleLoader.prototype.getModules = function () {
    var self = this;
    return this._modules.map(function (mod) {
      // 의존성 경고 확인
      var depWarning = self._depWarnings.find(function (w) { return w.moduleId === mod.id; });
      return {
        id: mod.id,
        name: mod.name || mod.id,
        description: mod.description || '',
        version: mod.version || '0.0.0',
        type: mod.type || 'data',
        tags: mod.tags || [],
        author: mod.author || '',
        dependencies: mod.dependencies || [],
        depWarning: depWarning ? depWarning.missing : null,
        enabled: !!self._enabledState[mod.id],
        builtin: !!mod._builtin,
        user: !!mod._user
      };
    });
  };

  /**
   * 특정 모듈의 활성 여부
   */
  ModuleLoader.prototype.isEnabled = function (id) {
    return !!this._enabledState[id];
  };

  /**
   * 모듈 활성/비활성 토글 (즉시 저장)
   * @param {string} id - 모듈 ID
   * @param {boolean} enabled - 활성 여부
   * @returns {Promise}
   */
  ModuleLoader.prototype.setEnabled = function (id, enabled) {
    var self = this;
    this._enabledState[id] = !!enabled;

    // 모듈 적용/해제
    var mod = this._modules.find(function (m) { return m.id === id; });
    if (mod) {
      if (enabled) {
        this._applyModule(mod);
      } else {
        this._unapplyModule(mod);
      }
      this._rebuildDefaults();
    }

    // 저장
    return new Promise(function (resolve) {
      var data = {};
      data[STORAGE_KEY] = self._enabledState;
      try {
        chrome.storage.sync.set(data, function () {
          if (chrome.runtime.lastError) {
            LOG('상태 저장 실패:', chrome.runtime.lastError.message);
          }
          resolve();
        });
      } catch (e) {
        LOG('상태 저장 예외:', e.message);
        resolve();
      }
    });
  };

  /**
   * 특정 네임스페이스의 설정 기본값 반환
   * @param {string} namespace - 예: 'combat'
   * @returns {object|null}
   */
  ModuleLoader.prototype.getConfigDefaults = function (namespace) {
    return this._configNamespaces[namespace] || null;
  };

  /**
   * 활성 모듈의 트리거 합산 배열 반환
   * @returns {Array}
   */
  ModuleLoader.prototype.getTriggers = function () {
    return this._triggers;
  };

  /**
   * 로드 완료 여부
   */
  ModuleLoader.prototype.isLoaded = function () {
    return this._loaded;
  };

  /**
   * 의존성 경고 목록 반환
   * @returns {Array<{moduleId, moduleName, missing: string[]}>}
   */
  ModuleLoader.prototype.getDependencyWarnings = function () {
    return this._depWarnings;
  };

  // ══════════════════════════════════════════════════════════
  //  사용자 모듈 관리 API
  // ══════════════════════════════════════════════════════════

  /**
   * 모듈 매니페스트 유효성 검증
   * @param {object} json - 모듈 매니페스트 JSON
   * @returns {{ valid: boolean, errors: string[] }}
   */
  ModuleLoader.prototype.validateModule = function (json) {
    var errors = [];

    if (!json || typeof json !== 'object') {
      return { valid: false, errors: ['유효한 JSON 객체가 아닙니다.'] };
    }

    REQUIRED_FIELDS.forEach(function (field) {
      if (!json[field]) errors.push('필수 필드 누락: ' + field);
    });

    if (json.id && !/^[a-zA-Z0-9_-]+$/.test(json.id)) {
      errors.push('모듈 ID는 영문, 숫자, 하이픈, 밑줄만 허용됩니다: ' + json.id);
    }

    if (json.type && json.type !== 'data' && json.type !== 'script') {
      errors.push('지원되는 타입: "data", "script" (받은 값: ' + json.type + ')');
    }

    // script 모듈 검증
    if (json.type === 'script') {
      if (!json.script) {
        errors.push('script 타입 모듈에는 "script" 필드가 필요합니다.');
      } else if (!json.script.code && !json.script.file) {
        errors.push('script 필드에 "code" 또는 "file"이 필요합니다.');
      }
      if (json.script && json.script.file && !json._builtin) {
        errors.push('사용자 script 모듈은 "file" 대신 "code"를 사용해야 합니다.');
      }
    }

    // 의존성 필드 검증
    if (json.dependencies) {
      if (!Array.isArray(json.dependencies)) {
        errors.push('dependencies는 문자열 배열이어야 합니다.');
      } else {
        json.dependencies.forEach(function (dep) {
          if (typeof dep !== 'string') errors.push('dependencies 요소는 문자열이어야 합니다: ' + dep);
        });
      }
    }

    // 내장 모듈 ID와 충돌 검사
    var self = this;
    if (json.id && this._modules.some(function (m) { return m.id === json.id && m._builtin; })) {
      errors.push('내장 모듈과 ID가 충돌합니다: ' + json.id);
    }

    return { valid: errors.length === 0, errors: errors };
  };

  /**
   * 사용자 모듈 추가 (JSON 가져오기)
   * @param {object} manifestJSON - 모듈 매니페스트 객체
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  ModuleLoader.prototype.addUserModule = function (manifestJSON) {
    var self = this;
    var validation = this.validateModule(manifestJSON);
    if (!validation.valid) {
      return Promise.resolve({ success: false, error: validation.errors.join('\n') });
    }

    var id = manifestJSON.id;

    // 이미 동일 ID의 사용자 모듈이 있으면 교체
    var existIdx = -1;
    for (var i = 0; i < this._modules.length; i++) {
      if (this._modules[i].id === id && this._modules[i]._user) {
        existIdx = i;
        break;
      }
    }
    if (existIdx >= 0) {
      this._unapplyModule(this._modules[existIdx]);
      this._modules.splice(existIdx, 1);
    }

    // 모듈 등록
    var mod = JSON.parse(JSON.stringify(manifestJSON));
    mod._builtin = false;
    mod._user = true;
    this._registerModule(mod);
    this._rebuildDefaults();

    // chrome.storage.local에 저장
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(USER_MODULES_KEY, function (result) {
          var store = (result && result[USER_MODULES_KEY]) || {};
          // _builtin, _user, _path 등 내부 플래그 제거 후 저장
          var clean = JSON.parse(JSON.stringify(manifestJSON));
          delete clean._builtin;
          delete clean._user;
          delete clean._path;
          store[id] = clean;

          var data = {};
          data[USER_MODULES_KEY] = store;
          chrome.storage.local.set(data, function () {
            if (chrome.runtime.lastError) {
              LOG('사용자 모듈 저장 실패:', chrome.runtime.lastError.message);
              resolve({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            self._saveEnabledState();
            LOG('사용자 모듈 추가:', id);
            resolve({ success: true });
          });
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  };

  /**
   * 사용자 모듈 제거
   * @param {string} id - 모듈 ID
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  ModuleLoader.prototype.removeUserModule = function (id) {
    var self = this;

    // 내장 모듈은 제거 불가
    var mod = this._modules.find(function (m) { return m.id === id; });
    if (!mod) {
      return Promise.resolve({ success: false, error: '모듈을 찾을 수 없습니다: ' + id });
    }
    if (mod._builtin) {
      return Promise.resolve({ success: false, error: '내장 모듈은 제거할 수 없습니다.' });
    }

    // 적용 해제 + 목록에서 제거
    this._unapplyModule(mod);
    this._modules = this._modules.filter(function (m) { return m.id !== id; });
    delete this._enabledState[id];
    this._rebuildDefaults();

    // storage에서 삭제
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(USER_MODULES_KEY, function (result) {
          var store = (result && result[USER_MODULES_KEY]) || {};
          delete store[id];

          var data = {};
          data[USER_MODULES_KEY] = store;
          chrome.storage.local.set(data, function () {
            self._saveEnabledState();
            LOG('사용자 모듈 제거:', id);
            resolve({ success: true });
          });
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  };

  /**
   * 모듈을 JSON 문자열로 내보내기
   * @param {string} id - 모듈 ID
   * @returns {string|null} - JSON 문자열 또는 null
   */
  ModuleLoader.prototype.exportModule = function (id) {
    var mod = this._modules.find(function (m) { return m.id === id; });
    if (!mod) return null;
    // 내부 플래그 제거
    var clean = JSON.parse(JSON.stringify(mod));
    delete clean._builtin;
    delete clean._user;
    delete clean._path;
    return JSON.stringify(clean, null, 2);
  };

  // ── 싱글톤 인스턴스 노출 ──────────────────────────────────
  window.BWBR_ModuleLoader = new ModuleLoader();

})();
