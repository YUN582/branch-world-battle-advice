// ============================================================
// Ccofolia Extension - 설정 기본값 (코어 전용)
// 코코포리아 GM 보조 확장 프로그램
//
// [네임스페이스 분류]
//   BWBR_CORE_DEFAULTS   = 범용 설정 (TRPG 시스템 무관)
//     - general  : 일반 토글/숫자 설정
//     - selectors: 코코포리아 DOM 선택자
//
//   전투 설정(templates, timing, sounds, rules, patterns, traits)은
//   모듈 시스템(module-loader.js)이 modules/branch-world-combat.json에서
//   로드하여 BWBR_COMBAT_DEFAULTS에 주입합니다.
//
// 저장소 키:
//   chrome.storage.sync['bwbr_core']    ← BWBR_CORE_DEFAULTS 오버라이드
//   chrome.storage.sync['bwbr_combat']  ← 모듈이 제공하는 전투 설정 오버라이드
//   chrome.storage.sync['bwbr_modules'] ← 모듈 활성/비활성 상태
//   (v1 호환: bwbr_config → 자동 마이그레이션)
//
// 런타임 병합:
//   module-loader.js가 BWBR_COMBAT_DEFAULTS를 설정한 뒤
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
    autoConsumeActions: true,   // 주/보조 행동 자동 소모 (《...》【...】 패턴 감지 시)
    charShortcuts: true,        // 캐릭터 단축키 (Ctrl/Alt/Shift+숫자로 발화 캐릭터 변경)
    debugMode: false,           // 디버그 로그 출력
    sfxVolume: 0.45,            // 확장 프로그램 효과음 볼륨 (0~1)
    siteVolume: 1.0,            // 코코포리아 사이트 음량 (0~1)
    betterSoundbar: true,       // 더 나은 사운드바 (MUI Slider → 경량 슬라이더 교체)
    language: 'ko',             // UI 언어
    standingScale: 1.0,         // 대화창 내 스탠딩 이미지 확대 배율 (0.5~3.0)
    chatBubbleScale: 1.0,       // 대화창(말풍선) 전체 확대 배율 (0.5~3.0)
    messageStyle: false           // 메시지 스타일 변경 (시스템 가운데정렬 + 마크다운 렌더링)
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

// ── [COMBAT] 전투 설정은 모듈 시스템이 제공 ──────────────────
// modules/branch-world-combat.json → module-loader.js가 로드 →
// window.BWBR_COMBAT_DEFAULTS에 주입됩니다.
// 모듈 로드 전까지 빈 객체로 초기화 (안전한 참조 보장)
window.BWBR_COMBAT_DEFAULTS = {};

// ── 런타임 병합 (하위 호환) ──────────────────────────────────
// 초기값은 코어만. module-loader.js가 loadAll() 후 BWBR_DEFAULTS를
// 코어 + 활성 모듈 설정으로 재구성합니다.
window.BWBR_DEFAULTS = JSON.parse(JSON.stringify(window.BWBR_CORE_DEFAULTS));

// ── 설정 마이그레이션 유틸리티 ───────────────────────────────

/** 코어 네임스페이스 키 목록 */
window.BWBR_CORE_KEYS = ['general', 'selectors'];

/** 전투 네임스페이스 키 목록 (module-loader가 모듈 로드 시 갱신 가능) */
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
          console.log('[CE] 설정 마이그레이션 완료: bwbr_config → bwbr_core + bwbr_combat');
          resolve({ core: core, combat: combat });
        });
      });
    } catch (e) {
      console.warn('[CE] 마이그레이션 저장 실패:', e);
      resolve({ core: core, combat: combat });
    }
  });
};

// 한글 숫자 변환 (합 번호에 사용)
window.BWBR_KOREAN_NUMBERS = {
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5',
  6: '6', 7: '7', 8: '8', 9: '9', 10: '10'
};
