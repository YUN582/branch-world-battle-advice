// ============================================================
// Branch World Battle Roll - 설정 기본값
// 코코포리아 GM 보조 확장 프로그램
//
// [네임스페이스 분류]
//   BWBR_CORE_DEFAULTS   = 범용 설정 (TRPG 시스템 무관)
//     - general  : 일반 토글/숫자 설정
//     - selectors: 코코포리아 DOM 선택자
//   BWBR_COMBAT_DEFAULTS  = 가지세계 전투 전용 설정
//     - templates, timing, sounds, rules, patterns, traits
//
// 저장소 키:
//   chrome.storage.sync['bwbr_core']   ← BWBR_CORE_DEFAULTS 오버라이드
//   chrome.storage.sync['bwbr_combat'] ← BWBR_COMBAT_DEFAULTS 오버라이드
//   (v1 호환: bwbr_config → 자동 마이그레이션)
//
// 런타임 병합:
//   BWBR_DEFAULTS = { ...BWBR_CORE_DEFAULTS, ...BWBR_COMBAT_DEFAULTS }
//   → 기존 엔진이 config.templates, config.general 등으로 접근 가능
// ============================================================

// ── [CORE] 범용 코코포리아 확장 설정 ─────────────────────────
window.BWBR_CORE_DEFAULTS = {
  // ── 일반 설정 ──────────────────────────────────────────
  general: {
    enabled: true,              // 확장 프로그램 활성화
    manualMode: false,          // 수동 모드 (주사위 결과를 사용자가 직접 입력)
    showBattleLog: false,       // 전투 로그 표시 (UI 로그 영역 표시 여부)
    autoComplete: true,         // 채팅 자동완성 (괄호/따옴표 자동 닫기 + Tab 순환)
    autoScroll: true,           // 새 메시지 시 자동 스크롤
    showOverlay: true,          // 페이지 내 오버레이 표시
    autoConsumeActions: true,   // 주/보조 행동 자동 소모 (《...》【...】 패턴 감지 시)
    charShortcuts: true,        // 캐릭터 단축키 (Ctrl/Alt/Shift+숫자로 발화 캐릭터 변경)
    debugMode: false,           // 디버그 로그 출력
    sfxVolume: 0.45,            // 확장 프로그램 효과음 볼륨 (0~1)
    siteVolume: 1.0,            // 코코포리아 사이트 음량 (0~1)
    betterSoundbar: true,       // 더 나은 사운드바 (MUI Slider → 경량 슬라이더 교체)
    language: 'ko'              // UI 언어
  },

  // ── DOM 선택자 (코코포리아 전용) ───────────────────────────
  selectors: {
    chatContainer: [
      '[class*="MuiList-root"]',
      '[class*="chat-log"]',
      '[class*="message-list"]',
      '[role="log"]',
      '[class*="scroll"]'
    ],
    chatMessage: [
      '[class*="MuiListItem"]',
      '[class*="message"]',
      '[class*="chat-item"]'
    ],
    messageText: [
      '[class*="MuiTypography"]',
      '[class*="text"]',
      '[class*="content"]',
      '[class*="body"]',
      'p', 'span', 'div'
    ],
    chatInput: [
      'textarea[name="text"]',
      'textarea.MuiInputBase-inputMultiline',
      'textarea',
      '[contenteditable="true"]'
    ],
    sendButton: [
      'form button[type="submit"]',
      'button[type="submit"]'
    ]
  }
};

// ── [COMBAT] 가지세계 전투 전용 설정 ──────────────────────────
window.BWBR_COMBAT_DEFAULTS = {
  // ── 메시지 템플릿 ──────────────────────────────────────
  templates: {
    combatStart:
      '《합 개시》| ⚔️ {attacker} - {atkDice}/{atkCrit}/{atkFumble} | 🛡️ {defender} - {defDice}/{defCrit}/{defFumble}',
    roundHeader:
      '《{round}합》| ⚔️ {attacker} {atkDice} : 🛡️ {defender} {defDice} @{sound}',
    attackerRoll: '1D20 ⚔️ {attacker}',
    defenderRoll: '1D20 🛡️ {defender}',
    roundResultWin:
      '⚔️ {attacker}【{atkValue}】 vs 🛡️ {defender}【{defValue}】 → {winner} 승리!',
    roundResultCrit:
      '💥 {name} 대성공! 【{value}】 → 상대 주사위 파괴 & 주사위 +1',
    roundResultFumble:
      '💀 {name} 대실패! 【{value}】 → 자신 주사위 파괴 & 주사위 -1',
    roundResultBothCrit:
      '⚡ 쌍방 대성공! ⚔️【{atkValue}】 🛡️【{defValue}】 → 각자 주사위 +1',
    roundResultTie:
      '⚖️ 무승부! ⚔️【{atkValue}】 🛡️【{defValue}】 → 재굴림',
    victory: '《합 승리》\n{winnerIcon} {winner} @{sound}',
    combatCancel: '《합 중지》'
  },

  // ── 타이밍 설정 (밀리초) ────────────────────────────────
  timing: {
    beforeFirstRoll: 700,
    betweenRolls: 700,
    beforeRoundResult: 700,
    beforeNextRound: 700,
    beforeVictory: 700,
    resultTimeout: 3000
  },

  // ── 효과음 설정 ────────────────────────────────────────
  sounds: {
    combatStartSounds: ['합'],
    roundHeaderSounds: ['챙1', '챙2', '챙3'],
    resultNormalSounds: ['챙1', '챙2', '챙3'],
    resultSpecialSounds: ['챙4'],
    victorySounds: ['합'],
    battleStartSounds: [],
    turnStartSounds: [],
    actionConsumeSounds: ['발도1'],
    actionAddSounds: ['발도2'],
    battleEndSounds: []
  },

  // ── 전투 규칙 ──────────────────────────────────────────
  rules: {
    diceType: 20,
    criticalValue: 20,
    fumbleValue: 1,
    criticalBonus: 1,
    fumblePenalty: 1,
    tieRule: 'reroll'
  },

  // ── 정규식 패턴 ────────────────────────────────────────
  patterns: {
    triggerRegex:
      '《합\\s*개시》\\s*\\|?\\s*⚔\\uFE0F?\\s*(.+?)\\s*-\\s*(\\d+)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)(?:\\s*/\\s*([A-Za-z0-9]+))?\\s*\\|?\\s*🛡\\uFE0F?\\s*(.+?)\\s*-\\s*(\\d+)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)(?:\\s*/\\s*([A-Za-z0-9]+))?',
    diceResultRegex: '1[Dd]20[^0-9]*?[→＞>]\\s*(\\d+)',
    cancelRegex: '《합\\s*중지》'
  },

  // ── 종족 특성 정의 ─────────────────────────────────────
  traits: {
    H0: { name: '인간 특성', desc: '주사위 0 시 +1 부활, 크리 시 초기화' },
    H00: { name: '인간 특성 (잠재)', desc: '특성 없지만 대성공 시 초기화되어 사용 가능' },
    H1: { name: '공석', desc: '' },
    H2: { name: '공석', desc: '' },
    H3: { name: '공석', desc: '' },
    H4: { name: '피로 새겨진 역사', desc: '크리 시 다음 판정 대성공+2, 최대+5 누적, 비크리 시 초기화' },
    H40: { name: '피로 새겨진 역사 + 인간', desc: 'H4 스택 초기화 시 인간 특성 발동 → 추가 합 1회' },
    H400: { name: '피로 새겨진 역사 + 인간', desc: '대성공으로 인간 특성 획득 후, H4 초기화 시 발동 → 추가 합 1회' }
  }
};

// ── 런타임 병합 (하위 호환) ──────────────────────────────────
// 기존 엔진이 config.templates, config.general 등 평탄한 접근을 유지하도록
// CORE + COMBAT 기본값을 합쳐서 BWBR_DEFAULTS로 노출한다.
window.BWBR_DEFAULTS = Object.assign({},
  JSON.parse(JSON.stringify(window.BWBR_CORE_DEFAULTS)),
  JSON.parse(JSON.stringify(window.BWBR_COMBAT_DEFAULTS))
);

// ── 설정 마이그레이션 유틸리티 ───────────────────────────────

/** 코어 네임스페이스 키 목록 */
window.BWBR_CORE_KEYS = ['general', 'selectors'];

/** 전투 네임스페이스 키 목록 */
window.BWBR_COMBAT_KEYS = ['templates', 'timing', 'sounds', 'rules', 'patterns', 'traits'];

/**
 * v1 flat config (bwbr_config) → v2 namespaced (bwbr_core + bwbr_combat) 마이그레이션.
 * 최초 1회만 실행되고, 완료 후 bwbr_config를 삭제한다.
 * @param {object} oldConfig - 기존 bwbr_config 값
 * @returns {Promise<{core: object, combat: object}>}
 */
window.BWBR_migrateConfigV1toV2 = function(oldConfig) {
  var core = {};
  var combat = {};
  if (!oldConfig || typeof oldConfig !== 'object') {
    return Promise.resolve({ core: core, combat: combat });
  }

  window.BWBR_CORE_KEYS.forEach(function(k) {
    if (oldConfig[k] !== undefined) core[k] = oldConfig[k];
  });
  window.BWBR_COMBAT_KEYS.forEach(function(k) {
    if (oldConfig[k] !== undefined) combat[k] = oldConfig[k];
  });

  return new Promise(function(resolve) {
    try {
      chrome.storage.sync.set({ bwbr_core: core, bwbr_combat: combat }, function() {
        // 구 키 삭제
        chrome.storage.sync.remove('bwbr_config', function() {
          console.log('[BWBR] 설정 마이그레이션 완료: bwbr_config → bwbr_core + bwbr_combat');
          resolve({ core: core, combat: combat });
        });
      });
    } catch (e) {
      console.warn('[BWBR] 마이그레이션 저장 실패:', e);
      resolve({ core: core, combat: combat });
    }
  });
};

// 한글 숫자 변환 (합 번호에 사용)
window.BWBR_KOREAN_NUMBERS = {
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5',
  6: '6', 7: '7', 8: '8', 9: '9', 10: '10'
};
