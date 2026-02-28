// ============================================================
// Branch World Advice - 범용 트리거 엔진
// 패턴 매칭 + 파라미터 추출 + 동작 체인 실행
// ============================================================

(function () {
  'use strict';

  var LOG_TAG = '%c[BWBR 트리거]%c';
  var LOG_STYLE = ['color: #e040fb; font-weight: bold;', 'color: inherit;'];
  function LOG() {
    var args = [LOG_TAG].concat(LOG_STYLE);
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  // ── 스토리지 키 ──────────────────────────────────────
  var STORAGE_KEY = 'bwbr_triggers';

  // ── 기본 트리거: triggers/defaults.json에서 로드 ──
  var DEFAULT_TRIGGERS = []; // 런타임에 JSON 파일에서 채워짐

  /**
   * triggers/ 폴더의 JSON 파일에서 기본 트리거를 로드합니다.
   * Chrome 확장 프로그램 내부 리소스를 fetch로 읽습니다.
   */
  function _loadDefaultTriggersFromJSON() {
    var url = chrome.runtime.getURL('triggers/defaults.json');
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (arr) {
      if (Array.isArray(arr)) {
        DEFAULT_TRIGGERS = arr;
        LOG('기본 트리거 JSON 로드:', arr.length, '개');
      }
    }).catch(function (e) {
      LOG('기본 트리거 JSON 로드 실패 (빈 기본값 사용):', e.message);
      DEFAULT_TRIGGERS = [];
    });
  }

  // ══════════════════════════════════════════════════════════
  //  패턴 컴파일러
  // ══════════════════════════════════════════════════════════

  /**
   * 사용자 패턴을 정규식으로 컴파일합니다.
   *
   * 패턴 형식: 《이름》| {param1} | {param2}
   * 결과: /《\s*이름\s*》\s*\|\s*(.+?)\s*\|\s*(.+?)$/
   *
   * @param {string} pattern - 사용자 패턴 문자열
   * @returns {{ regex: RegExp, paramNames: string[] }} - 컴파일된 정규식과 파라미터 이름 목록
   */
  function compilePattern(pattern) {
    if (!pattern || typeof pattern !== 'string') return null;

    var paramNames = [];
    // {name} 파라미터를 추출하고 캡처 그룹으로 치환 (한국어 파라미터명 지원)
    var parts = pattern.split(/(\{[^}]+\})/);
    var regexStr = '';

    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      var m = part.match(/^\{([^}]+)\}$/);
      if (m) {
        // 파라미터 → 캡처 그룹
        paramNames.push(m[1]);
        regexStr += '(.+?)';
      } else {
        // 리터럴 부분 → 이스케이프 + 유연한 공백
        var escaped = part
          // 특수 문자 이스케이프
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          // 《 》 안의 공백을 유연하게
          .replace(/\\《/g, '《')
          .replace(/\\》/g, '》');

        // 《이름》 형태에서 이름 주위에 \s* 삽입
        escaped = escaped.replace(/《([^》]+)》/g, function (_, name) {
          return '《\\s*' + name.trim() + '\\s*》';
        });

        // | 구분자 주위에 유연한 공백
        escaped = escaped.replace(/\s*\\\|\s*/g, '\\s*\\|\\s*');

        // 일반 공백을 \s+로
        escaped = escaped.replace(/\s+/g, '\\s+');

        regexStr += escaped;
      }
    }

    // 끝에 남은 공백과 줄바꿈 허용
    // 단, 패턴이 》 또는 】로 끝나면 $ 앵커 생략 (주사위 결과 뒤에 텍스트가 올 수 있음)
    var trimmed = pattern.trim();
    if (trimmed.endsWith('》') || trimmed.endsWith('】')) {
      // 괄호 자체가 경계 역할을 하므로 $ 불필요
    } else {
      regexStr += '\\s*$';
    }

    try {
      return {
        regex: new RegExp(regexStr),
        paramNames: paramNames
      };
    } catch (e) {
      LOG('패턴 컴파일 실패:', pattern, e.message);
      return null;
    }
  }

  /**
   * 컴파일된 패턴으로 텍스트를 매칭하고 파라미터를 추출합니다.
   *
   * @param {string} text - 매칭할 텍스트
   * @param {{ regex: RegExp, paramNames: string[] }} compiled - 컴파일된 패턴
   * @returns {Object|null} - { param1: 'value1', ... } 또는 매칭 실패 시 null
   */
  function matchPattern(text, compiled) {
    if (!compiled || !compiled.regex) return null;
    var m = text.match(compiled.regex);
    if (!m) return null;

    var params = {};
    for (var i = 0; i < compiled.paramNames.length; i++) {
      params[compiled.paramNames[i]] = (m[i + 1] || '').trim();
    }
    return params;
  }

  /**
   * 템플릿 문자열에서 {param}을 실제 값으로 치환합니다.
   *
   * @param {string} template - 템플릿 문자열
   * @param {Object} params - 파라미터 딕셔너리
   * @returns {string}
   */
  function applyTemplate(template, params) {
    if (!template) return '';
    return template.replace(/\{([^}]+)\}/g, function (match, key) {
      return params.hasOwnProperty(key) ? params[key] : match;
    });
  }

  /**
   * 동작의 실행 조건을 평가합니다.
   * @param {Object} condition - { field, op, value }
   * @param {Object} params - 현재 파라미터
   * @returns {boolean}
   */
  function evaluateCondition(condition, params) {
    if (!condition || !condition.field) return true;
    // 필드명에서 {} 제거 (UI에서 {스탯}으로 입력해도 스탯으로 조회)
    var fieldName = condition.field.replace(/^\{|\}$/g, '');
    var rawVal = params[fieldName];
    // 존재/비어있음 연산자 (값 비교 없이 파라미터 유무만 확인)
    if (condition.op === 'empty') return rawVal == null || String(rawVal).trim() === '';
    if (condition.op === 'exists') return rawVal != null && String(rawVal).trim() !== '';
    if (rawVal == null) return false;
    var val = parseFloat(rawVal);
    var cmp = parseFloat(condition.value);
    if (isNaN(val) || isNaN(cmp)) {
      // 문자열 비교 폴백
      switch (condition.op) {
        case '==': return String(rawVal) === String(condition.value);
        case '!=': return String(rawVal) !== String(condition.value);
        default: return false;
      }
    }
    switch (condition.op) {
      case '>=': return val >= cmp;
      case '<=': return val <= cmp;
      case '>':  return val > cmp;
      case '<':  return val < cmp;
      case '==': return val === cmp;
      case '!=': return val !== cmp;
      default: return true;
    }
  }

  /**
   * 캐릭터의 스탯 실존 여부를 MAIN 월드에 질의합니다.
   * @param {string} charName - 캐릭터 이름
   * @param {string} statLabel - 스탯 라벨
   * @returns {Promise<boolean>}
   */
  function checkStatExists(charName, statLabel) {
    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        window.removeEventListener('bwbr-check-stat-exists-result', handler);
        resolve(false);
      }, 3000);
      function handler() {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-check-stat-exists-result', handler);
        var raw = document.documentElement.getAttribute('data-bwbr-check-stat-exists-result');
        document.documentElement.removeAttribute('data-bwbr-check-stat-exists-result');
        var result = null;
        if (raw) { try { result = JSON.parse(raw); } catch (e) {} }
        resolve(result ? !!result.exists : false);
      }
      window.addEventListener('bwbr-check-stat-exists-result', handler);
      document.documentElement.setAttribute('data-bwbr-check-stat-exists', JSON.stringify({
        charName: charName,
        statLabel: statLabel
      }));
      window.dispatchEvent(new CustomEvent('bwbr-check-stat-exists'));
    });
  }

  // ══════════════════════════════════════════════════════════
  //  TriggerEngine 클래스
  // ══════════════════════════════════════════════════════════

  function TriggerEngine() {
    this._triggers = [];
    this._compiled = new Map(); // id → { regex, paramNames }
    this._executing = false;
    this._lastExecTime = new Map(); // id → timestamp (디바운스)
    this._chat = null; // CocoforiaChatInterface 참조 (init 시 설정)
    this._flowStateGetter = null; // () => flowState
    this._awaitUserMessage = null; // () => Promise (메시지 순서 보장)
    this._getCurrentCombatCharName = null; // () => string|null
    this._getSpeakerName = null; // () => string|null (현재 발화 캐릭터)
    this._pendingDiceResolve = null; // dice 액션 결과 대기 resolve
  }

  /**
   * 엔진 초기화
   * @param {Object} opts
   * @param {Object} opts.chat - CocoforiaChatInterface 인스턴스
   * @param {Function} opts.getFlowState - 현재 flowState를 반환하는 함수
   * @param {Function} opts.awaitUserMessage - 사용자 메시지 대기 함수
   */
  TriggerEngine.prototype.init = function (opts) {
    this._chat = opts.chat;
    this._flowStateGetter = opts.getFlowState;
    this._awaitUserMessage = opts.awaitUserMessage;
    this._getCurrentCombatCharName = opts.getCurrentCombatCharName || null;
    this._getSpeakerName = opts.getSpeakerName || null;
  };

  /**
   * 트리거 목록 로드 (chrome.storage.local + 기본 제공 병합)
   */
  TriggerEngine.prototype.load = function () {
    var self = this;
    // 1) triggers/defaults.json에서 기본 트리거 로드
    return _loadDefaultTriggersFromJSON().then(function () {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get(STORAGE_KEY, function (result) {
            if (chrome.runtime.lastError) {
              LOG('트리거 로드 실패:', chrome.runtime.lastError.message);
              self._triggers = DEFAULT_TRIGGERS.slice();
              self._compileAll();
              resolve();
              return;
            }
            var saved = result[STORAGE_KEY] || [];
            // 기본 트리거 + 사용자 트리거 병합
            var builtinIds = {};
            DEFAULT_TRIGGERS.forEach(function (t) { builtinIds[t.id] = true; });
            // 사용자가 기본 트리거를 비활성화한 경우를 반영
            var userOverrides = {};
            saved.forEach(function (t) {
              if (builtinIds[t.id]) {
                userOverrides[t.id] = t;
              }
            });
            // 저장소에 남아있는 삭제된 전투 트리거 정리
            var REMOVED_IDS = {
              '_builtin_combat_main': true,
              '_builtin_combat_sub': true,
              '_builtin_combat_start': true,
              '_builtin_combat_end': true,
              '_builtin_turn_end': true
            };
            var merged = DEFAULT_TRIGGERS.map(function (bt) {
              if (userOverrides[bt.id]) {
                // enabled 상태만 사용자 설정을 따름
                return Object.assign({}, bt, { enabled: userOverrides[bt.id].enabled });
              }
              return Object.assign({}, bt);
            });
            // 사용자 정의 트리거 추가 (삭제된 전투 트리거 제외)
            saved.forEach(function (t) {
              if (!builtinIds[t.id] && !REMOVED_IDS[t.id]) merged.push(t);
            });
            self._triggers = merged;
            self._compileAll();
            LOG('트리거 로드 완료:', self._triggers.length, '개');
            resolve();
          });
        } catch (e) {
          LOG('트리거 로드 예외:', e.message);
          self._triggers = DEFAULT_TRIGGERS.slice();
          self._compileAll();
          resolve();
        }
      });
    });
  };

  /**
   * 트리거 목록 저장 (chrome.storage.local)
   */
  TriggerEngine.prototype.save = function () {
    var data = {};
    data[STORAGE_KEY] = this._triggers;
    try {
      chrome.storage.local.set(data);
      LOG('트리거 저장 완료:', this._triggers.length, '개');
    } catch (e) {
      LOG('트리거 저장 실패:', e.message);
    }
  };

  /** 모든 패턴 컴파일 */
  TriggerEngine.prototype._compileAll = function () {
    this._compiled.clear();
    for (var i = 0; i < this._triggers.length; i++) {
      var t = this._triggers[i];
      var c = compilePattern(t.pattern);
      if (c) this._compiled.set(t.id, c);
    }
  };

  /** 트리거 목록 반환 (읽기 전용 사본) */
  TriggerEngine.prototype.getTriggers = function () {
    return this._triggers.map(function (t) { return Object.assign({}, t); });
  };

  /** 트리거 추가 */
  TriggerEngine.prototype.addTrigger = function (trigger) {
    if (!trigger.id) trigger.id = 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    if (trigger.enabled === undefined) trigger.enabled = true;
    if (!trigger.source) trigger.source = 'input';
    if (!trigger.conditions) trigger.conditions = { states: [] };
    if (!trigger.actions) trigger.actions = [];
    if (!trigger.delay) trigger.delay = 300;
    if (!trigger.priority) trigger.priority = 0;
    this._triggers.push(trigger);
    var c = compilePattern(trigger.pattern);
    if (c) this._compiled.set(trigger.id, c);
    this.save();
    return trigger;
  };

  /** 트리거 수정 */
  TriggerEngine.prototype.updateTrigger = function (id, updates) {
    for (var i = 0; i < this._triggers.length; i++) {
      if (this._triggers[i].id === id) {
        Object.assign(this._triggers[i], updates);
        // 패턴이 바뀌면 재컴파일
        if (updates.pattern !== undefined) {
          var c = compilePattern(this._triggers[i].pattern);
          if (c) this._compiled.set(id, c);
          else this._compiled.delete(id);
        }
        this.save();
        return this._triggers[i];
      }
    }
    return null;
  };

  /** 트리거 삭제 */
  TriggerEngine.prototype.removeTrigger = function (id) {
    this._triggers = this._triggers.filter(function (t) { return t.id !== id; });
    this._compiled.delete(id);
    this.save();
  };

  /** 내보내기 (JSON 문자열) */
  TriggerEngine.prototype.exportJSON = function () {
    return JSON.stringify(this._triggers, null, 2);
  };

  /** 불러오기 (JSON 문자열) */
  TriggerEngine.prototype.importJSON = function (json) {
    try {
      var arr = JSON.parse(json);
      if (!Array.isArray(arr)) throw new Error('배열이 아닙니다');
      // 유효성 검사
      arr.forEach(function (t) {
        if (!t.id) throw new Error('id 필수');
      });
      this._triggers = arr;
      this._compileAll();
      this.save();
      LOG('트리거 가져오기 완료:', arr.length, '개');
      return { success: true, count: arr.length };
    } catch (e) {
      LOG('트리거 가져오기 실패:', e.message);
      return { success: false, error: e.message };
    }
  };

  // ══════════════════════════════════════════════════════════
  //  패턴 매칭 & 실행
  // ══════════════════════════════════════════════════════════

  /**
   * 텍스트에서 매칭되는 트리거를 찾습니다.
   *
   * @param {string} text - 채팅 텍스트
   * @param {'input'|'message'} source - 감지 경로
   * @returns {{ trigger: Object, params: Object }|null}
   */
  /**
   * @param {string} text - 채팅 텍스트
   * @param {'input'|'message'} source - 감지 경로
   * @param {number|null} [diceValue] - 주사위 결과값 (parseDiceResult 결과)
   * @returns {{ trigger: Object, params: Object }|null}
   */
  TriggerEngine.prototype.check = function (text, source, diceValue) {
    if (!text || this._executing) return null;

    var flowState = this._flowStateGetter ? this._flowStateGetter() : 'IDLE';

    // 우선순위 내림차순 → 같은 우선순위면 더 긴 패턴 우선 (더 구체적)
    var sorted = this._triggers.slice().sort(function (a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (b.pattern || '').length - (a.pattern || '').length;
    });

    for (var i = 0; i < sorted.length; i++) {
      var t = sorted[i];
      if (!t.enabled) continue;

      // source 필터
      if (t.source !== 'both' && t.source !== source) continue;

      // 상태 조건 필터
      if (t.conditions && t.conditions.states && t.conditions.states.length > 0) {
        if (t.conditions.states.indexOf(flowState) === -1) continue;
      }

      // 디바운스 (같은 트리거 500ms 이내 재실행 방지)
      var lastExec = this._lastExecTime.get(t.id) || 0;
      if (Date.now() - lastExec < 500) continue;

      // 패턴 매칭 (빈 패턴은 모든 텍스트 매칭 — 주사위 조건 전용 트리거용)
      var params;
      if (!t.pattern || t.pattern.trim() === '') {
        params = {};
      } else {
        var compiled = this._compiled.get(t.id);
        if (!compiled) continue;
        params = matchPattern(text, compiled);
        if (!params) continue;
      }

      // 주사위 결과값 자동 파라미터 (영어 + 한국어 별칭)
      if (diceValue != null) {
        params._dice = String(diceValue);
        params['_주사위'] = String(diceValue);
      }

      // 전투 캐릭터 이름 자동 파라미터 (영어 + 한국어 별칭)
      if (this._getCurrentCombatCharName) {
        var selfName = this._getCurrentCombatCharName();
        if (selfName) {
          params._self = selfName;
          params['_차례'] = selfName;
          params['_자신'] = selfName; // 스피커 없으면 폴백
        }
      }

      // 현재 발화(선택) 캐릭터 이름 자동 파라미터
      if (this._getSpeakerName) {
        var speakerName = this._getSpeakerName();
        if (speakerName) {
          params['_자신'] = speakerName; // NEW: 자신 = 선택 캐릭터
          params['_화자'] = speakerName;   // 하위 호환
        }
      }

      return { trigger: t, params: params };
    }
    return null;
  };

  /**
   * 매칭된 트리거의 동작 체인을 실행합니다.
   *
   * @param {Object} trigger - 트리거 객체
   * @param {Object} params - 추출된 파라미터
   * @param {boolean} fromInput - onInputSubmit 경유 여부 (메시지 순서 보장용)
   */
  TriggerEngine.prototype.execute = async function (trigger, params, fromInput) {
    if (this._executing) {
      LOG('이미 실행 중 — 건너뜀');
      return;
    }

    this._executing = true;
    this._lastExecTime.set(trigger.id, Date.now());
    LOG('트리거 실행:', trigger.name, '| params:', params);

    try {
      // 입력 경유 시 사용자 메시지 도착 대기
      if (fromInput && this._awaitUserMessage) {
        await this._awaitUserMessage();
      }

      var actions = trigger.actions || [];
      var conditionResult = true; // 조건 평가 결과 (기본: 통과)
      for (var i = 0; i < actions.length; i++) {
        var action = actions[i];

        // 조건 체인 아이템: 통과/차단 게이트
        if (action.type === 'condition_dice' || action.type === 'condition_text') {
          var condOp = action.op || '>=';
          // stat_exists / stat_not_exists: 캐릭터에 실제 스탯이 있는지 확인
          if (condOp === 'stat_exists' || condOp === 'stat_not_exists') {
            // field → 스탯 라벨 (파라미터 치환: {스탯} 또는 스탯 모두 지원)
            var fieldRaw = (action.field || '').replace(/^\{|\}$/g, '');
            var statName = params[fieldRaw] != null ? String(params[fieldRaw]) : applyTemplate(action.field || '', params);
            statName = statName.replace(/^\{|\}$/g, '');
            // value → 캐릭터 이름 (파라미터 치환)
            var valRaw = (action.value || '').replace(/^\{|\}$/g, '');
            var charName = params[valRaw] != null ? String(params[valRaw]) : applyTemplate(action.value || '', params);
            charName = charName.replace(/^\{|\}$/g, '');
            // value가 비어있으면 현재 발화 캐릭터 사용
            if (!charName && this._getSpeakerName) charName = this._getSpeakerName();
            if (!charName && this._getCurrentCombatCharName) charName = this._getCurrentCombatCharName();
            var found = await checkStatExists(charName, statName);
            conditionResult = condOp === 'stat_exists' ? found : !found;
          } else {
            conditionResult = evaluateCondition({
              field: action.type === 'condition_dice' ? '_dice' : action.field,
              op: condOp,
              value: action.value || '0'
            }, params);
          }
          if (!conditionResult) {
            LOG('조건 미충족, 그룹 내 동작 건너뜀');
          } else {
            LOG('조건 충족, 그룹 내 동작 실행');
          }
          continue;
        }

        // inGroup: 조건 그룹에 속한 동작만 조건 결과에 영향받음
        // inGroup === undefined이면 기본값 true (하위 호환)
        var inGroup = action.inGroup !== false;
        if (inGroup && !conditionResult) continue;

        await this._executeAction(action, params);

        // 다음 동작 전 딜레이 (트리거 글로벌 딜레이 + 개별 동작 딜레이)
        if (i < actions.length - 1) {
          var actionDelay = (action.delay != null) ? parseInt(action.delay, 10) : trigger.delay;
          if (actionDelay > 0) await _delay(actionDelay);
        }
      }
    } catch (e) {
      LOG('트리거 실행 오류:', e.message || e);
    } finally {
      this._executing = false;
    }
  };

  /**
   * 개별 동작 실행
   */
  TriggerEngine.prototype._executeAction = async function (action, params) {
    switch (action.type) {
      case 'message':      await this._actionMessage(action, params); break;
      case 'cutin':        await this._actionCutin(action, params); break;
      case 'stat':         await this._actionStat(action, params); break;
      case 'dice':         await this._actionDice(action, params); break;
      case 'char_message': await this._actionCharMessage(action, params); break;
      case 'param':        await this._actionParam(action, params); break;
      case 'face':         await this._actionFace(action, params); break;
      case 'move':         await this._actionMove(action, params); break;
      case 'initiative':   await this._actionInitiative(action, params); break;
      case 'memo':         await this._actionMemo(action, params); break;
      case 'sound':        await this._actionSound(action, params); break;
      case 'load_scene':   await this._actionLoadScene(action, params); break;
      case 'stat_all':      await this._actionStatAll(action, params); break;
      case 'wait':          await _delay(parseInt(action.ms || '0', 10)); break;
      default:
        LOG('알 수 없는 동작 타입:', action.type);
    }
  };

  /** 시스템 메시지 전송 */
  TriggerEngine.prototype._actionMessage = async function (action, params) {
    var text = applyTemplate(action.template, params);
    if (!text) return;
    // 컷인 태그가 포함되어 있으면 그대로 보냄 (@태그 자동 처리됨)
    if (this._chat) {
      await this._chat.sendSystemMessage(text);
      LOG('메시지 전송:', text.substring(0, 80));
    }
  };

  /** 컷인 재생 (@태그를 빈 메시지로 보내면 컷인만 재생) */
  TriggerEngine.prototype._actionCutin = async function (action, params) {
    var tag = applyTemplate(action.tag || '', params);
    if (!tag) return;
    // sendSystemMessage에 @태그만 보내면 컷인 재생
    if (this._chat) {
      await this._chat.sendSystemMessage('@' + tag.replace(/^@/, ''));
      LOG('컷인 재생:', tag);
    }
  };

  /** 캐릭터 스탯 변경 (bwbr-modify-status 이벤트) */
  TriggerEngine.prototype._actionStat = async function (action, params) {
    var targetName = applyTemplate(action.target || '', params);
    var statLabel = applyTemplate(action.stat || '', params);
    var op = action.op || '+';
    var rawValue = applyTemplate(String(action.value || '0'), params);
    var numValue = parseInt(rawValue, 10);
    if (isNaN(numValue)) {
      LOG('스탯 변경 실패: 숫자가 아님 →', rawValue);
      return;
    }

    var valueType = action.valueType || 'value'; // 'value' 또는 'max'
    LOG('스탯 변경 요청:', targetName, statLabel, op, numValue, '(' + valueType + ')');

    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        window.removeEventListener('bwbr-modify-status-result', handler);
        LOG('스탯 변경 타임아웃');
        resolve();
      }, 5000);

      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-modify-status-result', handler);
        // DOM 속성 브릿지 (MAIN → ISOLATED 크로스-월드 안정성)
        var raw = document.documentElement.getAttribute('data-bwbr-modify-status-result');
        document.documentElement.removeAttribute('data-bwbr-modify-status-result');
        var result = null;
        if (raw) { try { result = JSON.parse(raw); } catch (x) {} }
        if (result && result.success) {
          LOG('스탯 변경 완료:', result.target, result.status,
            result.oldVal, '→', result.newVal);
        } else {
          LOG('스탯 변경 실패:', result && result.error);
        }
        resolve();
      }

      window.addEventListener('bwbr-modify-status-result', handler);
      // ISOLATED → MAIN 이벤트 전송
      var detail = {
        targetName: targetName,
        statusLabel: statLabel,
        operation: op,
        value: numValue,
        valueType: valueType
      };
      document.documentElement.setAttribute('data-bwbr-modify-status', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-modify-status', { detail: detail }));
    });
  };

  /** 캐릭터 메시지 전송 (특정 캐릭터 이름/아이콘으로 RP 메시지) */
  TriggerEngine.prototype._actionCharMessage = async function (action, params) {
    var targetName = applyTemplate(action.target || '', params);
    var text = applyTemplate(action.template || '', params);
    if (!text || !targetName) return;

    LOG('캐릭터 메시지 요청:', targetName, text.substring(0, 60));

    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        window.removeEventListener('bwbr-char-msg-result', handler);
        resolve();
      }, 5000);
      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-char-msg-result', handler);
        resolve();
      }
      window.addEventListener('bwbr-char-msg-result', handler);
      // 캐릭터 정보를 redux-injector에 요청하여 전송
      var detail = { targetName: targetName, text: text };
      document.documentElement.setAttribute('data-bwbr-trigger-char-msg', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-trigger-char-msg', { detail: detail }));
    });
  };

  /** 파라미터 변경 (캐릭터 params[] 배열 수정) */
  TriggerEngine.prototype._actionParam = async function (action, params) {
    var targetName = applyTemplate(action.target || '', params);
    var paramLabel = applyTemplate(action.param || '', params);
    var rawValue = applyTemplate(String(action.value || ''), params);
    var op = action.op || '=';
    if (!targetName || !paramLabel) return;

    LOG('파라미터 변경 요청:', targetName, paramLabel, op, rawValue);

    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        window.removeEventListener('bwbr-modify-param-result', handler);
        resolve();
      }, 5000);
      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-modify-param-result', handler);
        if (e.detail && e.detail.success) {
          LOG('파라미터 변경 완료:', e.detail.target, e.detail.param, e.detail.oldVal, '→', e.detail.newVal);
        } else {
          LOG('파라미터 변경 실패:', e.detail && e.detail.error);
        }
        resolve();
      }
      window.addEventListener('bwbr-modify-param-result', handler);
      var detail = { targetName: targetName, paramLabel: paramLabel, operation: op, value: rawValue };
      document.documentElement.setAttribute('data-bwbr-modify-param', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-modify-param', { detail: detail }));
    });
  };

  /** 표정/아이콘 변경 */
  TriggerEngine.prototype._actionFace = async function (action, params) {
    var targetName = applyTemplate(action.target || '', params);
    var faceIdx = parseInt(applyTemplate(String(action.faceIndex || '0'), params), 10);
    if (!targetName) return;

    LOG('표정 변경 요청:', targetName, '인덱스', faceIdx);

    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        window.removeEventListener('bwbr-trigger-char-field-result', handler);
        resolve();
      }, 5000);
      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-trigger-char-field-result', handler);
        resolve();
      }
      window.addEventListener('bwbr-trigger-char-field-result', handler);
      var detail = { targetName: targetName, field: 'face', value: faceIdx };
      document.documentElement.setAttribute('data-bwbr-trigger-char-field', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-trigger-char-field', { detail: detail }));
    });
  };

  /** 캐릭터 이동 (맵 좌표) */
  TriggerEngine.prototype._actionMove = async function (action, params) {
    var targetName = applyTemplate(action.target || '', params);
    var x = parseInt(applyTemplate(String(action.x || '0'), params), 10);
    var y = parseInt(applyTemplate(String(action.y || '0'), params), 10);
    var relative = action.relative === 'true' || action.relative === true;
    if (!targetName) return;

    LOG('이동 요청:', targetName, relative ? '상대' : '절대', x, y);

    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        window.removeEventListener('bwbr-trigger-char-field-result', handler);
        resolve();
      }, 5000);
      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-trigger-char-field-result', handler);
        resolve();
      }
      window.addEventListener('bwbr-trigger-char-field-result', handler);
      var detail = { targetName: targetName, field: 'move', x: x, y: y, relative: relative };
      document.documentElement.setAttribute('data-bwbr-trigger-char-field', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-trigger-char-field', { detail: detail }));
    });
  };

  /** 이니셔티브 변경 */
  TriggerEngine.prototype._actionInitiative = async function (action, params) {
    var targetName = applyTemplate(action.target || '', params);
    var rawValue = applyTemplate(String(action.value || '0'), params);
    var numValue = parseInt(rawValue, 10);
    if (isNaN(numValue)) return;
    if (!targetName) return;

    LOG('이니셔티브 변경 요청:', targetName, numValue);

    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        window.removeEventListener('bwbr-trigger-char-field-result', handler);
        resolve();
      }, 5000);
      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-trigger-char-field-result', handler);
        resolve();
      }
      window.addEventListener('bwbr-trigger-char-field-result', handler);
      var detail = { targetName: targetName, field: 'initiative', value: numValue };
      document.documentElement.setAttribute('data-bwbr-trigger-char-field', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-trigger-char-field', { detail: detail }));
    });
  };

  /** 메모 변경 */
  TriggerEngine.prototype._actionMemo = async function (action, params) {
    var targetName = applyTemplate(action.target || '', params);
    var text = applyTemplate(action.memo || '', params);
    if (!targetName) return;

    LOG('메모 변경 요청:', targetName, text.substring(0, 40));

    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        window.removeEventListener('bwbr-trigger-char-field-result', handler);
        resolve();
      }, 5000);
      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-trigger-char-field-result', handler);
        resolve();
      }
      window.addEventListener('bwbr-trigger-char-field-result', handler);
      var detail = { targetName: targetName, field: 'memo', value: text };
      document.documentElement.setAttribute('data-bwbr-trigger-char-field', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-trigger-char-field', { detail: detail }));
    });
  };

  /** 사운드 재생 (확장 프로그램 내장 사운드) */
  TriggerEngine.prototype._actionSound = async function (action, params) {
    var file = applyTemplate(action.file || '', params);
    if (!file) return;
    LOG('사운드 재생:', file);
    try {
      var url = chrome.runtime.getURL('sounds/' + file);
      var audio = new Audio(url);
      audio.volume = action.volume != null ? parseFloat(action.volume) : 0.5;
      await audio.play();
    } catch (e) {
      LOG('사운드 재생 실패:', e.message || e);
    }
  };

  /** 네이티브 장면 불러오기 */
  TriggerEngine.prototype._actionLoadScene = async function (action, params) {
    var sceneName = applyTemplate(action.sceneName || '', params);
    if (!sceneName) return;
    var applyOption = action.applyOption || 'all'; // all, noBgm, noText
    LOG('장면 불러오기 요청:', sceneName, '(적용:', applyOption + ')');

    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        window.removeEventListener('bwbr-load-native-scene-result', handler);
        resolve();
      }, 5000);
      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-load-native-scene-result', handler);
        if (e.detail && e.detail.success) {
          LOG('장면 적용 완료:', sceneName);
        } else {
          LOG('장면 적용 실패:', e.detail && e.detail.error);
        }
        resolve();
      }
      window.addEventListener('bwbr-load-native-scene-result', handler);
      var detail = { sceneName: sceneName, applyOption: applyOption };
      document.documentElement.setAttribute('data-bwbr-load-native-scene', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-load-native-scene', { detail: detail }));
    });
  };

  /** 전체 캐릭터 스탯 일괄 변경 (bwbr-modify-status-all 이벤트) */
  TriggerEngine.prototype._actionStatAll = async function (action, params) {
    var statLabel = applyTemplate(action.stat || '', params);
    var op = action.op || '=';
    var rawValue = applyTemplate(String(action.value || '0'), params);
    var numValue = parseInt(rawValue, 10);
    // =max 연산은 value 불필요
    if (op !== '=max' && isNaN(numValue)) {
      LOG('전체 스탯 변경 실패: 숫자가 아님 →', rawValue);
      return;
    }
    var valueType = action.valueType || 'value';
    LOG('전체 스탯 변경 요청:', statLabel, op, numValue, '(' + valueType + ')');

    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        window.removeEventListener('bwbr-modify-status-all-result', handler);
        LOG('전체 스탯 변경 타임아웃');
        resolve();
      }, 10000);
      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-modify-status-all-result', handler);
        // DOM 속성 브릿지 (MAIN → ISOLATED 크로스-월드 안정성)
        var raw = document.documentElement.getAttribute('data-bwbr-modify-status-all-result');
        document.documentElement.removeAttribute('data-bwbr-modify-status-all-result');
        var result = null;
        if (raw) { try { result = JSON.parse(raw); } catch (x) {} }
        if (result && result.success) {
          LOG('전체 스탯 변경 완료:', result.affected, '명 캐릭터');
        } else {
          LOG('전체 스탯 변경 실패:', result && result.error);
        }
        resolve();
      }
      window.addEventListener('bwbr-modify-status-all-result', handler);
      var detail = {
        statusLabel: statLabel,
        operation: op,
        value: numValue,
        valueType: valueType
      };
      document.documentElement.setAttribute('data-bwbr-modify-status-all', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-modify-status-all', { detail: detail }));
    });
  };

  /** 주사위 굴림 (사용자 캐릭터로 메시지 전송, 결과 캡처) */
  TriggerEngine.prototype._actionDice = async function (action, params) {
    var command = applyTemplate(action.command || '', params);
    if (!command) return;
    if (!this._chat) return;

    // 주사위 결과 캡처 프로미스 설정
    var self = this;
    var dicePromise = new Promise(function (resolve) {
      self._pendingDiceResolve = resolve;
      // 타임아웃 5초
      setTimeout(function () {
        if (self._pendingDiceResolve === resolve) {
          self._pendingDiceResolve = null;
          resolve(null);
        }
      }, 5000);
    });

    await this._chat.sendMessage(command);
    LOG('주사위 굴림:', command);

    // 결과 대기 (content.js onNewMessage에서 resolvePendingDice 호출)
    var result = await dicePromise;
    if (result != null) {
      params._dice = String(result);
      LOG('주사위 결과 캡처:', result);
    }
  };

  /** 주사위 결과 수신 (content.js onNewMessage에서 호출) */
  TriggerEngine.prototype.resolvePendingDice = function (diceValue) {
    if (this._pendingDiceResolve && diceValue != null) {
      var resolve = this._pendingDiceResolve;
      this._pendingDiceResolve = null;
      resolve(diceValue);
    }
  };

  // ── 유틸 ─────────────────────────────────────────

  function _delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ══════════════════════════════════════════════════════════
  //  전역 노출
  // ══════════════════════════════════════════════════════════

  window.TriggerEngine = TriggerEngine;
  LOG('trigger-engine.js 로드 완료');

})();
