// ============================================================
// Branch World Battle Roll - 전투 보조 엔진
// 전투 개시, 차례 관리, 행동 추적
// ============================================================

window.CombatEngine = class CombatEngine {
  constructor(config) {
    this.config = config || window.BWBR_DEFAULTS;
    this.reset();
  }

  /** 상태 초기화 */
  reset() {
    this.inCombat = false;
    this.turnOrder = [];      // 이니셔티브 순 캐릭터 배열
    this.currentTurnIndex = -1;
    this.currentTurn = null;  // 현재 차례 캐릭터 정보
    this._characterData = []; // 캐릭터 데이터 (Content Script에서 전달)
  }

  /** 설정 업데이트 */
  updateConfig(config) {
    this.config = config;
  }

  // ── 트리거 파싱 ─────────────────────────────────────────

  /**
   * 전투 개시 트리거 감지
   * @param {string} text - 채팅 메시지 텍스트
   * @returns {boolean}
   */
  parseCombatStartTrigger(text) {
    // 《 전투개시 》 또는 《 전투 개시 》 (뒤에 @컷인 가능)
    const pattern = /《\s*전투\s*개시\s*》/;
    return pattern.test(text);
  }

  /**
   * 차례 종료 트리거 감지
   * @param {string} text - 채팅 메시지 텍스트
   * @returns {boolean}
   */
  parseTurnEndTrigger(text) {
    // 《 차례 종료 》 또는 《 차례종료 》 (뒤에 @컷인 가능)
    const pattern = /《\s*차례\s*종료\s*》/;
    return pattern.test(text);
  }

  /**
   * 전투 종료 트리거 감지
   * @param {string} text - 채팅 메시지 텍스트
   * @returns {boolean}
   */
  parseCombatEndTrigger(text) {
    // 《 전투종료 》 또는 《 전투 종료 》 (뒤에 @컷인 가능)
    const pattern = /《\s*전투\s*종료\s*》/;
    return pattern.test(text);
  }

  /**
   * 차례 시작 메시지 파싱 (관전자용)
   * 형식: 《 {이름}의 차례 》\n🔺주 행동 {N}개, 🔹보조 행동 {Y}개 | 이동거리 {Z}
   * @param {string} text - 채팅 메시지 텍스트
   * @returns {object|null} { name, mainActions, subActions, movement }
   */
  parseTurnStartMessage(text) {
    const pattern = /《\s*(.+?)의\s*차례\s*》[\s|]+🔺?\s*주\s*행동\s*(\d+)개\s*[,\/]\s*🔹?\s*보조\s*행동\s*(\d+)개\s*[|\s]+이동거리\s*(\S+)/u;
    const match = text.match(pattern);
    if (!match) return null;
    return {
      name: match[1].trim(),
      mainActions: parseInt(match[2]),
      mainActionsMax: parseInt(match[2]),  // 시작 시점이므로 max와 같음
      subActions: parseInt(match[3]),
      subActionsMax: parseInt(match[3]),
      movement: match[4]
    };
  }

  /**
   * 행동 소비 메시지 파싱 (관전자용)
   * 형식: 《{주/보조} 행동 소비》\n{이름} | 🔺주 행동 {N}, 🔹보조 행동 {Y} | 이동거리 {Z}
   * @param {string} text - 채팅 메시지 텍스트
   * @returns {object|null} { actionType, name, mainActions, subActions, movement }
   */
  parseActionConsumedMessage(text) {
    const pattern = /《[\u{1F53A}\u{1F539}]?(주|보조)\s*행동\s*소비》[\s|]+(.+?)\s*\|\s*\u{1F53A}?\s*주\s*행동\s*(\d+)\s*[,\/]\s*\u{1F539}?\s*보조\s*행동\s*(\d+)\s*\|\s*이동거리\s*(\S+)/u;
    const match = text.match(pattern);
    if (!match) return null;
    return {
      actionType: match[1],
      name: match[2].trim(),
      mainActions: parseInt(match[3]),
      subActions: parseInt(match[4]),
      movement: match[5]
    };
  }

  /**
   * 행동 추가 메시지 파싱 (관전자용)
   * 형식: 《{주/보조} 행동 추가》\n{이름} | 🔺주 행동 {N}, 🔹보조 행동 {Y} | 이동거리 {Z}
   * @param {string} text - 채팅 메시지 텍스트
   * @returns {object|null} { actionType, name, mainActions, subActions, movement }
   */
  parseActionAddedMessage(text) {
    const pattern = /《[\u{1F53A}\u{1F539}]?(주|보조)\s*행동\s*추가》[\s|]+(.+?)\s*\|\s*\u{1F53A}?\s*주\s*행동\s*(\d+)\s*[,\/]\s*\u{1F539}?\s*보조\s*행동\s*(\d+)\s*\|\s*이동거리\s*(\S+)/u;
    const match = text.match(pattern);
    if (!match) return null;
    return {
      actionType: match[1],
      name: match[2].trim(),
      mainActions: parseInt(match[3]),
      subActions: parseInt(match[4]),
      movement: match[5]
    };
  }

  /**
   * 주 행동 주사위 굴림 감지
   * 형식1: 1d20+{수정치} ({대성공}/{대실패}) | 《...》 |
   * 형식2: 《...》 (단독으로)
   * @param {string} text - 채팅 메시지 텍스트
   * @returns {boolean}
   */
  parseMainActionRoll(text) {
    // 제외 패턴: 시스템 메시지 (차례, 전투개시, 전투종료, 차례종료, 행동 소비/추가, 합 개시/승리/종료)
    if (/《\s*[\u{1F53A}\u{1F539}]?\s*(전투\s*개시|전투\s*종료|차례\s*종료|.+의\s*차례|(주|보조)\s*행동\s*(소비|추가)|합\s*개시|합\s*승리|합\s*종료|\d+합)\s*》/u.test(text)) {
      return false;
    }
    
    // 1d20으로 시작하고, | 《...》 | 형식이 있는 경우
    const detailedPattern = /1[dD]20[^|]*\|\s*《[^》]+》\s*\|/;
    // 단순히 《...》 패턴
    const simplePattern = /《[^》]+》/;
    return detailedPattern.test(text) || simplePattern.test(text);
  }

  /**
   * 보조 행동 감지
   * 형식: 【...】
   * @param {string} text - 채팅 메시지 텍스트
   * @returns {boolean}
   */
  parseSubActionRoll(text) {
    // 【...】 패턴
    return /【[^】]+】/.test(text);
  }

  /**
   * 합 개시 메시지에서 공격자 이름 추출
   * 형식: 《합 개시》| ⚔️ {공격자} - ... | 🛡️ {방어자} - ...
   * @param {string} text - 채팅 메시지 텍스트
   * @returns {string|null} 공격자 이름 또는 null
   */
  parseMeleeStartAttacker(text) {
    const pattern = /《합\s*개시》\s*\|?\s*⚔\uFE0F?\s*(.+?)\s*-\s*\d+/;
    const match = text.match(pattern);
    if (!match) return null;
    return match[1].trim();
  }

  // ── 캐릭터 데이터 읽기 ───────────────────────────────────

  /**
   * 캐릭터 데이터 설정 (Content Script에서 전달받음)
   * @param {Array} characters - 캐릭터 배열
   */
  setCharacterData(characters) {
    this._characterData = characters || [];
    this._log(`캐릭터 데이터 설정: ${this._characterData.length}명`);
  }

  /**
   * 활성 캐릭터 목록 가져오기
   * @returns {Array} 캐릭터 배열
   */
  getActiveCharacters() {
    if (!this._characterData || this._characterData.length === 0) {
      this._log('캐릭터 데이터가 없습니다. setCharacterData()를 먼저 호출하세요.');
      return [];
    }
    
    // 활성화된 캐릭터만 필터링
    return this._characterData.filter(c => c && c.active !== false);
  }

  /**
   * 캐릭터에서 파라미터 값 추출
   * @param {object} char - 캐릭터 객체
   * @param {string} label - 파라미터 라벨
   * @returns {string|null}
   */
  getParamValue(char, label) {
    if (!char.params) return null;
    const param = char.params.find(p => p.label === label || p.label.includes(label));
    return param ? param.value : null;
  }

  /**
   * 캐릭터에서 상태 값 추출
   * @param {object} char - 캐릭터 객체
   * @param {string} label - 상태 라벨
   * @returns {object|null} { value, max }
   */
  getStatusValue(char, label) {
    if (!char.status) return null;
    const status = char.status.find(s => s.label === label || s.label.includes(label));
    return status ? { value: status.value, max: status.max } : null;
  }

  // ── 전투 시작 ───────────────────────────────────────────

  /**
   * 전투 시작 - 캐릭터 목록을 이니셔티브 순으로 정렬
   * @returns {object} { success, turnOrder, message }
   */
  startCombat() {
    const characters = this.getActiveCharacters();
    
    if (characters.length === 0) {
      return {
        success: false,
        message: '활성화된 캐릭터가 없습니다.'
      };
    }

    // 이니셔티브 순으로 정렬 (높은 순)
    this.turnOrder = characters
      .map(char => {
        // params에서 주 행동/보조 행동 개수 파싱
        const mainParam = this.getParamValue(char, '주 행동') || this.getParamValue(char, '주행동');
        const subParam = this.getParamValue(char, '보조 행동') || this.getParamValue(char, '보조행동');
        
        const mainMax = parseInt(mainParam) || 1;
        const subMax = parseInt(subParam) || 1;
        
        return {
          id: char._id,
          name: char.name,
          initiative: char.initiative || 0,
          mainActions: mainMax,           // 현재 남은 주 행동
          mainActionsMax: mainMax,        // 최대 주 행동 (리셋용)
          subActions: subMax,             // 현재 남은 보조 행동
          subActionsMax: subMax,          // 최대 보조 행동 (리셋용)
          movement: this.getParamValue(char, '이동거리') || '?',
          iconUrl: char.iconUrl || null,
          originalData: char
        };
      })
      .sort((a, b) => b.initiative - a.initiative);

    this.inCombat = true;
    this.currentTurnIndex = -1;

    this._log(`전투 시작! ${this.turnOrder.length}명 참가`);
    this._log(`차례 순서: ${this.turnOrder.map(c => `${c.name}(${c.initiative})`).join(' → ')}`);

    return {
      success: true,
      turnOrder: this.turnOrder,
      message: this._formatCombatStartMessage()
    };
  }

  /**
   * 전투 시작 메시지 포맷
   */
  _formatCombatStartMessage() {
    const orderList = this.turnOrder
      .map((c, i) => `${i + 1}. ${c.name} (이니셔티브 ${c.initiative})`)
      .join('\n');
    
    return `《 전투 개시 》\n\n▶ 차례 순서:\n${orderList}`;
  }

  // ── 차례 관리 ───────────────────────────────────────────

  /**
   * 다음 차례로 이동
   * @returns {object} { success, turn, message }
   */
  nextTurn() {
    if (!this.inCombat || this.turnOrder.length === 0) {
      return { success: false, message: '전투가 진행 중이 아닙니다.' };
    }

    this.currentTurnIndex++;
    
    // 모든 캐릭터가 차례를 마치면 다시 처음부터
    if (this.currentTurnIndex >= this.turnOrder.length) {
      this.currentTurnIndex = 0;
      // 새 라운드 시작 시 행동 리셋 (최대값으로)
      this.turnOrder.forEach(c => {
        c.mainActions = c.mainActionsMax;
        c.subActions = c.subActionsMax;
      });
    }

    this.currentTurn = this.turnOrder[this.currentTurnIndex];
    
    // 행동 리셋 (새 차례 시작) - 최대값으로
    this.currentTurn.mainActions = this.currentTurn.mainActionsMax;
    this.currentTurn.subActions = this.currentTurn.subActionsMax;

    this._log(`${this.currentTurn.name}의 차례 시작`);

    return {
      success: true,
      turn: this.currentTurn,
      message: this._formatTurnMessage()
    };
  }

  /**
   * 현재 차례 메시지 포맷
   */
  _formatTurnMessage() {
    const t = this.currentTurn;
    if (!t) return '';
    
    return `《 ${t.name}의 차례 》| 🔺주 행동 ${t.mainActions}개 / 🔹보조 행동 ${t.subActions}개 | 이동거리 ${t.movement}`;
  }

  // ── 행동 처리 ───────────────────────────────────────────

  /**
   * 주 행동 사용 (-1)
   * @returns {object} { success, remaining, message }
   */
  useMainAction() {
    if (!this.currentTurn) {
      return { success: false, message: '현재 차례가 없습니다.' };
    }

    if (this.currentTurn.mainActions <= 0) {
      return { success: false, message: '남은 주 행동이 없습니다.' };
    }

    this.currentTurn.mainActions--;
    
    this._log(`${this.currentTurn.name}: 주 행동 사용 (남은 주 행동: ${this.currentTurn.mainActions})`);

    return {
      success: true,
      remaining: {
        mainActions: this.currentTurn.mainActions,
        subActions: this.currentTurn.subActions
      },
      message: this._formatRemainingActionsMessage()
    };
  }

  /**
   * 보조 행동 사용 (-1)
   * @returns {object} { success, remaining, message }
   */
  useSubAction() {
    if (!this.currentTurn) {
      return { success: false, message: '현재 차례가 없습니다.' };
    }

    if (this.currentTurn.subActions <= 0) {
      return { success: false, message: '남은 보조 행동이 없습니다.' };
    }

    this.currentTurn.subActions--;
    
    this._log(`${this.currentTurn.name}: 보조 행동 사용 (남은 보조 행동: ${this.currentTurn.subActions})`);

    return {
      success: true,
      remaining: {
        mainActions: this.currentTurn.mainActions,
        subActions: this.currentTurn.subActions
      },
      message: this._formatRemainingActionsMessage()
    };
  }

  /**
   * 주 행동을 보조 행동으로 전환
   * @returns {object} { success, remaining, message }
   */
  convertMainToSub() {
    if (!this.currentTurn) {
      return { success: false, message: '현재 차례가 없습니다.' };
    }

    if (this.currentTurn.mainActions <= 0) {
      return { success: false, message: '전환할 주 행동이 없습니다.' };
    }

    this.currentTurn.mainActions--;
    this.currentTurn.subActions++;
    
    this._log(`${this.currentTurn.name}: 주 행동 → 보조 행동 전환`);

    return {
      success: true,
      remaining: {
        mainActions: this.currentTurn.mainActions,
        subActions: this.currentTurn.subActions
      },
      message: `주 행동을 보조 행동으로 전환했습니다. ${this._formatRemainingActionsMessage()}`
    };
  }

  /**
   * 주 행동 추가 (+1)
   * @param {boolean} extendMax - max 값도 함께 증가시킬지 여부 (기본: false)
   * @returns {object} { success, remaining, message }
   */
  addMainAction(extendMax = false) {
    if (!this.currentTurn) {
      return { success: false, message: '현재 차례가 없습니다.' };
    }

    this.currentTurn.mainActions++;
    if (extendMax || this.currentTurn.mainActions > this.currentTurn.mainActionsMax) {
      this.currentTurn.mainActionsMax = this.currentTurn.mainActions;
    }
    
    this._log(`${this.currentTurn.name}: 주 행동 추가 (현재 주 행동: ${this.currentTurn.mainActions}/${this.currentTurn.mainActionsMax})`);

    return {
      success: true,
      remaining: {
        mainActions: this.currentTurn.mainActions,
        subActions: this.currentTurn.subActions,
        mainActionsMax: this.currentTurn.mainActionsMax,
        subActionsMax: this.currentTurn.subActionsMax
      },
      message: this._formatRemainingActionsMessage()
    };
  }

  /**
   * 보조 행동 추가 (+1)
   * @param {boolean} extendMax - max 값도 함께 증가시킬지 여부 (기본: false)
   * @returns {object} { success, remaining, message }
   */
  addSubAction(extendMax = false) {
    if (!this.currentTurn) {
      return { success: false, message: '현재 차례가 없습니다.' };
    }

    this.currentTurn.subActions++;
    if (extendMax || this.currentTurn.subActions > this.currentTurn.subActionsMax) {
      this.currentTurn.subActionsMax = this.currentTurn.subActions;
    }
    
    this._log(`${this.currentTurn.name}: 보조 행동 추가 (현재 보조 행동: ${this.currentTurn.subActions}/${this.currentTurn.subActionsMax})`);

    return {
      success: true,
      remaining: {
        mainActions: this.currentTurn.mainActions,
        subActions: this.currentTurn.subActions,
        mainActionsMax: this.currentTurn.mainActionsMax,
        subActionsMax: this.currentTurn.subActionsMax
      },
      message: this._formatRemainingActionsMessage()
    };
  }

  /**
   * 남은 행동 메시지 포맷
   */
  _formatRemainingActionsMessage() {
    const t = this.currentTurn;
    if (!t) return '';
    
    return `▶ ${t.name}: 주 행동 ${t.mainActions}개 / 보조 행동 ${t.subActions}개 남음`;
  }

  // ── 전투 종료 ───────────────────────────────────────────

  /**
   * 전투 종료
   * @returns {object} { success, message }
   */
  endCombat() {
    if (!this.inCombat) {
      return { success: false, message: '전투가 진행 중이 아닙니다.' };
    }

    this._log('전투 종료');
    this.reset();

    return {
      success: true,
      message: '《 전투 종료 》'
    };
  }

  // ── 상태 확인 ───────────────────────────────────────────

  /**
   * 현재 전투 상태 반환
   */
  getStatus() {
    return {
      inCombat: this.inCombat,
      turnOrder: this.turnOrder,
      currentTurnIndex: this.currentTurnIndex,
      currentTurn: this.currentTurn
    };
  }

  /**
   * 현재 전투 상태 반환 (content.js 호환용)
   */
  getState() {
    return {
      inCombat: this.inCombat,
      turnOrder: this.turnOrder,
      currentTurnIndex: this.currentTurnIndex,
      currentCharacter: this.currentTurn  // content.js에서 currentCharacter로 접근
    };
  }

  // ── 유틸리티 ────────────────────────────────────────────

  _log(msg) {
    console.log(`%c[Combat Engine]%c ${msg}`, 'color: #ff5722; font-weight: bold;', 'color: inherit;');
  }
};
