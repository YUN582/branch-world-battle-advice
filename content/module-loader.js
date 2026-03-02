// ============================================================
// Branch World Module Loader
// 데이터 모듈(JSON)을 로드하여 설정/트리거를 코어에 등록
//
// 모듈 JSON 포맷은 ARCHITECTURE.md §5 참조.
// 내장 모듈은 modules/ 폴더에 위치하며 chrome.runtime.getURL로 접근.
// 활성/비활성 상태는 chrome.storage.sync['bwbr_modules']에 저장.
//
// 공개 API:
//   window.BWBR_ModuleLoader
//     .loadAll()               → Promise  (내장 모듈 로드 + 상태 적용)
//     .getModules()            → Array<{id, name, description, version, type, tags, enabled}>
//     .isEnabled(id)           → boolean
//     .setEnabled(id, bool)    → Promise  (상태 변경 + 저장)
//     .getConfigDefaults(ns)   → object|null  (특정 네임스페이스의 기본값)
//     .getTriggers()           → Array  (활성 모듈의 트리거 합산)
// ============================================================

(function () {
  'use strict';

  // ── 내장 모듈 경로 (Chrome 확장은 디렉토리 열거 불가 → 하드코딩) ──
  var BUILTIN_MODULES = [
    'modules/branch-world/manifest.json',
    'modules/triggers/manifest.json'
  ];

  var STORAGE_KEY = 'bwbr_modules'; // { moduleId: boolean }

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

  // ── loadAll: 내장 모듈 전부 로드 + 활성 상태 적용 ─────────

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
          self._loadModuleFiles().then(function () {
            self._loaded = true;
            resolve();
          });
        });
      } catch (e) {
        LOG('storage 접근 실패:', e.message);
        self._enabledState = {};
        self._loadModuleFiles().then(function () {
          self._loaded = true;
          resolve();
        });
      }
    });
  };

  // ── 내부: 모듈 파일들을 fetch로 로드 ──────────────────────

  ModuleLoader.prototype._loadModuleFiles = function () {
    var self = this;

    var promises = BUILTIN_MODULES.map(function (path) {
      return self._fetchModule(path);
    });

    return Promise.all(promises).then(function (results) {
      // 로드된 모듈 등록
      results.forEach(function (mod) {
        if (!mod) return;
        self._modules.push(mod);

        // 최초 로드 시 기본 활성 (내장 모듈은 기본 enabled)
        if (self._enabledState[mod.id] === undefined) {
          self._enabledState[mod.id] = true;
        }

        // 활성 모듈만 적용
        if (self._enabledState[mod.id]) {
          self._applyModule(mod);
        }
      });

      // 활성 상태 저장 (첫 로드 시 기본값 기록)
      self._saveEnabledState();

      // BWBR_DEFAULTS 재구성 (코어 + 활성 모듈 설정 병합)
      self._rebuildDefaults();

      LOG('모듈 로드 완료:', self._modules.length, '개,',
          'active:', self._modules.filter(function (m) { return self._enabledState[m.id]; }).length);
    }).catch(function (e) {
      LOG('모듈 로드 중 오류:', e.message);
    });
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
        enabled: !!self._enabledState[mod.id],
        builtin: !!mod._builtin
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

  // ── 싱글톤 인스턴스 노출 ──────────────────────────────────
  window.BWBR_ModuleLoader = new ModuleLoader();

})();
