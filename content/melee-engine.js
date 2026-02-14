// ============================================================
// Branch World Battle Roll - 근접전 합 처리 엔진
// 주사위 비교, 크리티컬/대실패 처리, 승패 판정
// ============================================================

window.BattleRollEngine = class BattleRollEngine {
  constructor(config) {
    this.config = config || window.BWBR_DEFAULTS;
    this.reset();
  }

  /** 엔진 상태 초기화 */
  reset() {
    this.combat = null;
    this.round = 0;
    this.lastAttackerRoll = null;
    this.lastDefenderRoll = null;
    this.history = [];
  }

  /** 설정 업데이트 */
  updateConfig(config) {
    this.config = config;
  }

  // ── 트리거 파싱 ─────────────────────────────────────────

  /**
   * 채팅 텍스트에서 합 개시 트리거를 파싱합니다.
   * @param {string} text - 채팅 메시지 텍스트
   * @returns {object|null} 파싱된 전투 데이터 또는 null
   */
  parseTrigger(text) {
    const regexStr = this.config.patterns.triggerRegex;
    this._log(`parseTrigger 입력: "${text.substring(0, 100)}"`);
    this._log(`parseTrigger 정규식: ${regexStr}`);
    try {
      var pattern = new RegExp(regexStr);
    } catch (e) {
      console.error('[BWBR Engine] 정규식 오류:', e);
      return null;
    }
    const match = text.match(pattern);
    this._log(`parseTrigger 매칭 결과: ${match ? 'O (' + match.length + '그룹)' : 'X'}`);
    if (!match) return null;

    return {
      attacker: {
        name: match[1].trim(),
        dice: parseInt(match[2], 10),
        crits: parseInt(match[3], 10),
        fumbles: parseInt(match[4], 10)
      },
      defender: {
        name: match[5].trim(),
        dice: parseInt(match[6], 10),
        crits: parseInt(match[7], 10),
        fumbles: parseInt(match[8], 10)
      }
    };
  }

  /**
   * 전투 중지 트리거를 감지합니다.
   * @param {string} text - 채팅 메시지 텍스트
   * @returns {boolean}
   */
  parseCancelTrigger(text) {
    const pattern = new RegExp(this.config.patterns.cancelRegex);
    return pattern.test(text);
  }

  // ── 전투 상태 관리 ───────────────────────────────────────

  /**
   * 전투 시작
   * @param {object} attacker - {name, dice, crits, fumbles}
   * @param {object} defender - {name, dice, crits, fumbles}
   */
  startCombat(attacker, defender) {
    this.combat = {
      attacker: { ...attacker },
      defender: { ...defender }
    };
    this.round = 0;
    this.lastAttackerRoll = null;
    this.lastDefenderRoll = null;
    this.history = [];

    this._log(`전투 시작: ⚔️ ${attacker.name}(${attacker.dice}) vs 🛡️ ${defender.name}(${defender.dice})`);
  }

  /** 라운드 번호 증가 */
  incrementRound() {
    this.round++;
  }

  /** 공격자 주사위 값 설정 */
  setAttackerRoll(value) {
    this.lastAttackerRoll = value;
  }

  /** 방어자 주사위 값 설정 */
  setDefenderRoll(value) {
    this.lastDefenderRoll = value;
  }

  // ── 라운드 결과 처리 ─────────────────────────────────────

  /**
   * 현재 라운드의 주사위 결과를 처리하고 상태를 업데이트합니다.
   * @returns {object} 라운드 결과 정보
   */
  processRoundResult() {
    if (!this.combat || this.lastAttackerRoll === null || this.lastDefenderRoll === null) {
      throw new Error('전투 상태 또는 주사위 값이 올바르지 않습니다.');
    }

    const atkVal = this.lastAttackerRoll;
    const defVal = this.lastDefenderRoll;
    const rules = this.config.rules;

    const atkCrit = (atkVal === rules.criticalValue);
    const atkFumble = (atkVal === rules.fumbleValue);
    const defCrit = (defVal === rules.criticalValue);
    const defFumble = (defVal === rules.fumbleValue);

    let result = {
      round: this.round,
      attackerRoll: atkVal,
      defenderRoll: defVal,
      attackerCrit: atkCrit,
      attackerFumble: atkFumble,
      defenderCrit: defCrit,
      defenderFumble: defFumble,
      type: 'normal',        // 'normal' | 'crit' | 'fumble' | 'bothCrit' | 'bothFumble' | 'critVsFumble' | 'tie'
      winner: null,           // 'attacker' | 'defender' | null
      atkDiceChange: 0,
      defDiceChange: 0,
      description: ''
    };

    // ── 특수 케이스 판정 ──

    // 1) 쌍방 대성공
    if (atkCrit && defCrit) {
      result.type = 'bothCrit';
      result.atkDiceChange = +rules.criticalBonus;
      result.defDiceChange = +rules.criticalBonus;
      this.combat.attacker.crits++;
      this.combat.defender.crits++;
      result.description = this._formatTemplate(this.config.templates.roundResultBothCrit, {
        atkValue: atkVal,
        defValue: defVal
      });
    }
    // 2) 쌍방 대실패
    else if (atkFumble && defFumble) {
      result.type = 'bothFumble';
      result.atkDiceChange = -(1 + rules.fumblePenalty);  // 파괴(-1) + 페널티(-1) = -2
      result.defDiceChange = -(1 + rules.fumblePenalty);
      this.combat.attacker.fumbles++;
      this.combat.defender.fumbles++;
      result.description =
        this._formatTemplate(this.config.templates.roundResultFumble, { name: this.combat.attacker.name, value: atkVal }) +
        '\n' +
        this._formatTemplate(this.config.templates.roundResultFumble, { name: this.combat.defender.name, value: defVal });
    }
    // 3) 공격자 대성공 vs 방어자 대실패
    else if (atkCrit && defFumble) {
      result.type = 'critVsFumble';
      result.winner = 'attacker';
      result.atkDiceChange = +rules.criticalBonus;
      result.defDiceChange = -(1 + rules.fumblePenalty);
      this.combat.attacker.crits++;
      this.combat.defender.fumbles++;
      result.description =
        this._formatTemplate(this.config.templates.roundResultCrit, { name: this.combat.attacker.name, value: atkVal }) +
        '\n' +
        this._formatTemplate(this.config.templates.roundResultFumble, { name: this.combat.defender.name, value: defVal });
    }
    // 4) 방어자 대성공 vs 공격자 대실패
    else if (defCrit && atkFumble) {
      result.type = 'critVsFumble';
      result.winner = 'defender';
      result.defDiceChange = +rules.criticalBonus;
      result.atkDiceChange = -(1 + rules.fumblePenalty);
      this.combat.defender.crits++;
      this.combat.attacker.fumbles++;
      result.description =
        this._formatTemplate(this.config.templates.roundResultCrit, { name: this.combat.defender.name, value: defVal }) +
        '\n' +
        this._formatTemplate(this.config.templates.roundResultFumble, { name: this.combat.attacker.name, value: atkVal });
    }
    // 5) 공격자만 대성공
    else if (atkCrit) {
      result.type = 'crit';
      result.winner = 'attacker';
      result.atkDiceChange = +rules.criticalBonus;
      result.defDiceChange = -1;
      this.combat.attacker.crits++;
      result.description = this._formatTemplate(this.config.templates.roundResultCrit, {
        name: this.combat.attacker.name,
        value: atkVal
      });
    }
    // 6) 방어자만 대성공
    else if (defCrit) {
      result.type = 'crit';
      result.winner = 'defender';
      result.defDiceChange = +rules.criticalBonus;
      result.atkDiceChange = -1;
      this.combat.defender.crits++;
      result.description = this._formatTemplate(this.config.templates.roundResultCrit, {
        name: this.combat.defender.name,
        value: defVal
      });
    }
    // 7) 공격자만 대실패
    else if (atkFumble) {
      result.type = 'fumble';
      result.winner = 'defender';
      result.atkDiceChange = -(1 + rules.fumblePenalty);
      this.combat.attacker.fumbles++;
      result.description = this._formatTemplate(this.config.templates.roundResultFumble, {
        name: this.combat.attacker.name,
        value: atkVal
      });
    }
    // 8) 방어자만 대실패
    else if (defFumble) {
      result.type = 'fumble';
      result.winner = 'attacker';
      result.defDiceChange = -(1 + rules.fumblePenalty);
      this.combat.defender.fumbles++;
      result.description = this._formatTemplate(this.config.templates.roundResultFumble, {
        name: this.combat.defender.name,
        value: defVal
      });
    }
    // 9) 동점 (크리티컬/대실패 아님)
    else if (atkVal === defVal) {
      result.type = 'tie';
      result = this._handleTie(result);
    }
    // 10) 일반 비교
    else {
      result.type = 'normal';
      if (atkVal > defVal) {
        result.winner = 'attacker';
        result.defDiceChange = -1;
        result.description = this._formatTemplate(this.config.templates.roundResultWin, {
          attacker: this.combat.attacker.name,
          defender: this.combat.defender.name,
          atkValue: atkVal,
          defValue: defVal,
          winner: '⚔️ ' + this.combat.attacker.name
        });
      } else {
        result.winner = 'defender';
        result.atkDiceChange = -1;
        result.description = this._formatTemplate(this.config.templates.roundResultWin, {
          attacker: this.combat.attacker.name,
          defender: this.combat.defender.name,
          atkValue: atkVal,
          defValue: defVal,
          winner: '🛡️ ' + this.combat.defender.name
        });
      }
    }

    // 주사위 수 적용
    this.combat.attacker.dice = Math.max(0, this.combat.attacker.dice + result.atkDiceChange);
    this.combat.defender.dice = Math.max(0, this.combat.defender.dice + result.defDiceChange);

    // 이력 저장
    this.history.push(result);

    // 로그
    this._log(`${this.round}합 결과: ⚔️${atkVal} vs 🛡️${defVal} → ${result.type}`);
    this._log(`남은 주사위: ⚔️${this.combat.attacker.dice} / 🛡️${this.combat.defender.dice}`);

    // 주사위 값 초기화
    this.lastAttackerRoll = null;
    this.lastDefenderRoll = null;

    return result;
  }

  /** 동점 처리 */
  _handleTie(result) {
    const tieRule = this.config.rules.tieRule;
    switch (tieRule) {
      case 'reroll':
        result.description = this._formatTemplate(this.config.templates.roundResultTie, {
          atkValue: result.attackerRoll,
          defValue: result.defenderRoll
        });
        result.needsReroll = true;
        break;
      case 'bothLose':
        result.atkDiceChange = -1;
        result.defDiceChange = -1;
        result.description = this._formatTemplate(this.config.templates.roundResultTie, {
          atkValue: result.attackerRoll,
          defValue: result.defenderRoll
        }) + ' → 양쪽 주사위 파괴';
        break;
      case 'attackerWins':
        result.winner = 'attacker';
        result.defDiceChange = -1;
        result.description = this._formatTemplate(this.config.templates.roundResultWin, {
          attacker: this.combat.attacker.name,
          defender: this.combat.defender.name,
          atkValue: result.attackerRoll,
          defValue: result.defenderRoll,
          winner: '⚔️ ' + this.combat.attacker.name + ' (동점 공격자 우위)'
        });
        break;
      case 'defenderWins':
        result.winner = 'defender';
        result.atkDiceChange = -1;
        result.description = this._formatTemplate(this.config.templates.roundResultWin, {
          attacker: this.combat.attacker.name,
          defender: this.combat.defender.name,
          atkValue: result.attackerRoll,
          defValue: result.defenderRoll,
          winner: '🛡️ ' + this.combat.defender.name + ' (동점 방어자 우위)'
        });
        break;
      default: // 'nothing'
        result.description = this._formatTemplate(this.config.templates.roundResultTie, {
          atkValue: result.attackerRoll,
          defValue: result.defenderRoll
        });
        break;
    }
    return result;
  }

  // ── 승패 확인 ────────────────────────────────────────────

  /** 전투 종료 여부 확인 */
  isVictory() {
    if (!this.combat) return false;
    return this.combat.attacker.dice <= 0 || this.combat.defender.dice <= 0;
  }

  /** 승자 정보 반환 */
  getWinner() {
    if (!this.combat) return null;
    if (this.combat.attacker.dice <= 0 && this.combat.defender.dice <= 0) {
      return 'draw'; // 양쪽 모두 0 (쌍방 대실패 등)
    }
    if (this.combat.attacker.dice <= 0) return 'defender';
    if (this.combat.defender.dice <= 0) return 'attacker';
    return null;
  }

  /** 승리 메시지 생성 */
  getVictoryMessage() {
    const winner = this.getWinner();
    if (!winner) return '';

    if (winner === 'draw') {
      return '《합 종료》- 무승부 @합';
    }

    const winnerData = winner === 'attacker' ? this.combat.attacker : this.combat.defender;
    const winnerIcon = winner === 'attacker' ? '⚔️' : '🛡️';
    const sound = this.config.sounds.victorySounds[0] || '합';

    return this._formatTemplate(this.config.templates.victory, {
      winnerIcon: winnerIcon,
      winner: winnerData.name,
      sound: sound
    });
  }

  // ── 라운드 메시지 생성 ───────────────────────────────────

  /** 라운드 헤더 메시지 생성 */
  getRoundHeaderMessage() {
    if (!this.combat) return '';
    return this._formatTemplate(this.config.templates.roundHeader, {
      round: this.round,
      attacker: this.combat.attacker.name,
      atkDice: this.combat.attacker.dice,
      defender: this.combat.defender.name,
      defDice: this.combat.defender.dice
    });
  }

  /** 공격자 굴림 메시지 생성 */
  getAttackerRollMessage() {
    if (!this.combat) return '';
    const sounds = this.config.sounds.rollSounds;
    const sound = sounds[Math.floor(Math.random() * sounds.length)] || '';
    return this._formatTemplate(this.config.templates.attackerRoll, {
      attacker: this.combat.attacker.name,
      sound: sound
    });
  }

  /** 방어자 굴림 메시지 생성 */
  getDefenderRollMessage() {
    if (!this.combat) return '';
    const sounds = this.config.sounds.rollSounds;
    const sound = sounds[Math.floor(Math.random() * sounds.length)] || '';
    return this._formatTemplate(this.config.templates.defenderRoll, {
      defender: this.combat.defender.name,
      sound: sound
    });
  }

  // ── 상태 조회 ────────────────────────────────────────────

  /** 현재 전투 상태를 반환합니다. */
  getState() {
    return {
      combat: this.combat ? {
        attacker: { ...this.combat.attacker },
        defender: { ...this.combat.defender }
      } : null,
      round: this.round,
      history: [...this.history]
    };
  }

  // ── 유틸리티 ─────────────────────────────────────────────

  /** 템플릿 문자열에서 {key}를 값으로 교체합니다. */
  _formatTemplate(template, data) {
    if (!template) return '';
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return data[key] !== undefined ? String(data[key]) : match;
    });
  }

  /** 항상 출력되는 로그 */
  _log(msg) {
    console.log(`%c[BWBR Engine]%c ${msg}`, 'color: #e91e63; font-weight: bold;', 'color: inherit;');
  }
};
