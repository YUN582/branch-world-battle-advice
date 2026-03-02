// ============================================================
// Branch World Battle Roll - 설정 기본값
// 코코포리아 GM 보조 확장 프로그램
//
// [모듈 분류 가이드]
//   [CORE]   = 범용 설정 (TRPG 시스템 무관) → core/config.js
//   [COMBAT] = 가지세계 전투 전용 → modules/bw-combat/manifest.json
// ============================================================

window.BWBR_DEFAULTS = {
  // ── [COMBAT] 메시지 템플릿 ──────────────────────────────
  templates: {
    // 합 개시 트리거 (이 패턴이 채팅에 나타나면 전투 시작)
    // {attacker}, {defender} = 이름
    // {atkDice}, {atkCrit}, {atkFumble} = 공격자 주사위/대성공/대실패
    // {defDice}, {defCrit}, {defFumble} = 방어자 주사위/대성공/대실패
    combatStart:
      '《합 개시》| ⚔️ {attacker} - {atkDice}/{atkCrit}/{atkFumble} | 🛡️ {defender} - {defDice}/{defCrit}/{defFumble}',

    // 각 합 헤더
    roundHeader:
      '《{round}합》| ⚔️ {attacker} {atkDice} : 🛡️ {defender} {defDice} @{sound}',

    // 공격자 주사위 굴림 명령
    attackerRoll: '1D20 ⚔️ {attacker}',

    // 방어자 주사위 굴림 명령
    defenderRoll: '1D20 🛡️ {defender}',

    // 합 결과 메시지
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

    // 합 승리 메시지
    victory: '《합 승리》\n{winnerIcon} {winner} @{sound}',

    // 합 중지 메시지 (이 패턴 감지 시 전투 중지)
    combatCancel: '《합 중지》'
  },

  // ── [COMBAT] 타이밍 설정 (밀리초) ─────────────────────────
  timing: {
    beforeFirstRoll: 700,     // 합 헤더 출력 후 → 첫 번째 굴림까지 대기
    betweenRolls: 700,        // 공격자 결과 확인 후 → 방어자 굴림까지 대기
    beforeRoundResult: 700,   // 방어자 결과 확인 후 → 결과 출력까지 대기
    beforeNextRound: 700,     // 결과 출력 후 → 다음 합까지 대기
    beforeVictory: 700,       // 마지막 합 결과 후 → 승리 선언까지 대기
    resultTimeout: 3000       // 주사위 결과 대기 타임아웃 (초과 시 재시도)
  },

  // ── [COMBAT] 효과음 설정 ───────────────────────────────
  sounds: {
    combatStartSounds: ['합'],                        // 합 개시 시 효과음
    roundHeaderSounds: ['챙1', '챙2', '챙3'],          // 합 헤더 시 무작위
    resultNormalSounds: ['챙1', '챙2', '챙3'],      // 일반 결과 시 무작위
    resultSpecialSounds: ['챙4'],                   // 대성공/대실패 시 무작위
    victorySounds: ['합'],                              // 승리 시 무작위
    // 전투 보조 (턴제) 사운드
    battleStartSounds: [],                            // 전투 보조 개시 시
    turnStartSounds: [],                              // 차례 시작 시
    actionConsumeSounds: ['발도1'],                    // 행동 소비 시
    actionAddSounds: ['발도2'],                        // 행동 추가 시
    battleEndSounds: []                               // 전투 보조 종료 시
  },

  // ── [COMBAT] 전투 규칙 ──────────────────────────────────
  rules: {
    diceType: 20,           // D20 (주사위 면 수)
    criticalValue: 20,      // 대성공 값
    fumbleValue: 1,         // 대실패 값
    criticalBonus: 1,       // 대성공 시 추가 주사위 수
    fumblePenalty: 1,       // 대실패 시 추가 감소 주사위 수
    tieRule: 'reroll'       // 동점 처리: "reroll" | "bothLose" | "nothing" | "attackerWins" | "defenderWins"
  },

  // ── [COMBAT] 정규식 패턴 ────────────────────────────────
  patterns: {
    // 합 개시 트리거 감지 패턴
    // 이모지 뒤에 선택적 Variation Selector (U+FE0F)를 허용
    // 마지막 슬래시 뒤에 선택적 특성 태그 (H0H4 등) 캐처
    triggerRegex:
      '《합\\s*개시》\\s*\\|?\\s*⚔\\uFE0F?\\s*(.+?)\\s*-\\s*(\\d+)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)(?:\\s*/\\s*([A-Za-z0-9]+))?\\s*\\|?\\s*🛡\\uFE0F?\\s*(.+?)\\s*-\\s*(\\d+)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)(?:\\s*/\\s*([A-Za-z0-9]+))?',

    // 주사위 결과 감지 패턴 (캡처 그룹 1 = 결과 값)
    diceResultRegex: '1[Dd]20[^0-9]*?[→＞>]\\s*(\\d+)',

    // 전투 중지 감지 패턴
    cancelRegex: '《합\\s*중지》'
  },

  // ── [CORE] DOM 선택자 (코코포리아 전용) ─────────────────────
  selectors: {
    // 채팅 메시지 컨테이너 (새 메시지를 감시할 부모 요소)
    chatContainer: [
      '[class*="MuiList-root"]',
      '[class*="chat-log"]',
      '[class*="message-list"]',
      '[role="log"]',
      '[class*="scroll"]'
    ],

    // 개별 채팅 메시지 요소
    chatMessage: [
      '[class*="MuiListItem"]',
      '[class*="message"]',
      '[class*="chat-item"]'
    ],

    // 메시지 텍스트를 포함하는 요소 (메시지 안에서)
    messageText: [
      '[class*="MuiTypography"]',
      '[class*="text"]',
      '[class*="content"]',
      '[class*="body"]',
      'p', 'span', 'div'
    ],

    // 채팅 입력 필드
    chatInput: [
      'textarea[name="text"]',
      'textarea.MuiInputBase-inputMultiline',
      'textarea',
      '[contenteditable="true"]'
    ],

    // 전송 버튼 (코코포리아: form 안의 submit 버튼)
    sendButton: [
      'form button[type="submit"]',
      'button[type="submit"]'
    ]
  },

  // ── [CORE] 일반 설정 ──────────────────────────────────
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

  // ── [COMBAT] 종족 특성 정의 ────────────────────────────
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

// 한글 숫자 변환 (합 번호에 사용)
window.BWBR_KOREAN_NUMBERS = {
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5',
  6: '6', 7: '7', 8: '8', 9: '9', 10: '10'
};
