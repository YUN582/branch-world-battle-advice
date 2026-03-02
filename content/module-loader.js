// ============================================================
// Ccofolia Extension - Module Loader
// 내장 + 사용자 데이터 모듈(JSON)을 로드하여 설정/트리거를 코어에 등록
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
// ============================================================

(function () {
  'use strict';

  // ── 내장 모듈 경로 (Chrome 확장은 디렉토리 열거 불가 → 하드코딩) ──
  var BUILTIN_MODULES = [
    'modules/branch-world/manifest.json',
    'modules/triggers/manifest.json'
  ];

  var STORAGE_KEY = 'bwbr_modules';       // { moduleId: boolean } — chrome.storage.sync
  var USER_MODULES_KEY = 'bwbr_user_modules'; // { moduleId: manifestJSON } — chrome.storage.local

  // 모듈 매니페스트 필수 필드
  var REQUIRED_FIELDS = ['id', 'name', 'version', 'type'];

  function LOG() {
    if (window._BWBR_DEBUG) {
      var args = ['[BWBR ModuleLoader]'].concat(Array.prototype.slice.call(arguments));
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

          // 최종 집계 + BWBR_DEFAULTS 재구성
          self._saveEnabledState();
          self._rebuildDefaults();

          LOG('전체 모듈 로드 완료:', self._modules.length, '개,',
              'active:', self._modules.filter(function (m) { return self._enabledState[m.id]; }).length);
          resolve();
        });
      } catch (e) {
        LOG('사용자 모듈 storage 접근 실패:', e.message);
        // 내장 모듈 기준으로 마무리
        self._saveEnabledState();
        self._rebuildDefaults();
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

    // 활성 모듈만 적용
    if (this._enabledState[mod.id]) {
      this._applyModule(mod);
    }
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
        console.warn('[BWBR ModuleLoader] 모듈 로드 실패 (' + path + '):', e.message);
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  };

  // ── 내부: 모듈 적용 (설정 + 트리거 등록) ──────────────────

  ModuleLoader.prototype._applyModule = function (mod) {
    // config.defaults → 네임스페이스별 설정 등록
    if (mod.config && mod.config.namespace && mod.config.defaults) {
      var ns = mod.config.namespace;
      this._configNamespaces[ns] = JSON.parse(JSON.stringify(mod.config.defaults));

      // 특수 처리: 'combat' 네임스페이스 → window.BWBR_COMBAT_DEFAULTS
      // 기존 코드(loadConfig, combat-controller 등)와의 하위 호환 유지
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
      return {
        id: mod.id,
        name: mod.name || mod.id,
        description: mod.description || '',
        version: mod.version || '0.0.0',
        type: mod.type || 'data',
        tags: mod.tags || [],
        author: mod.author || '',
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

    if (json.type && json.type !== 'data') {
      errors.push('현재 "data" 타입만 지원됩니다. (받은 값: ' + json.type + ')');
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
