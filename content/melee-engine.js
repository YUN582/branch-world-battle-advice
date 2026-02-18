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
    try {
      var pattern = new RegExp(regexStr);
    } catch (e) {
      console.error('[BWBR Engine] 정규식 오류:', e);
      return null;
    }
    const match = text.match(pattern);
    if (match) this._log(`parseTrigger 매칭 성공! (${match.length}그룹)`);
    if (!match) return null;

    return {
      attacker: {
        name: match[1].trim(),
        dice: parseInt(match[2], 10),
        critThreshold: parseInt(match[3], 10),
        fumbleThreshold: parseInt(match[4], 10),
        traits: this._parseTraits(match[5] || '')
      },
      defender: {
        name: match[6].trim(),
        dice: parseInt(match[7], 10),
        critThreshold: parseInt(match[8], 10),
        fumbleThreshold: parseInt(match[9], 10),
        traits: this._parseTraits(match[10] || '')
      }
    };
  }

  /**
   * 특성 태그 문자열을 파싱합니다. ("H0H4" → ['H0', 'H4'], "H00H4" → ['H00', 'H4'])
   * @param {string} tagStr - 특성 태그 문자열
   * @returns {string[]} 특성 배열
   */
  _parseTraits(tagStr) {
    if (!tagStr) return [];
    const matches = tagStr.toUpperCase().match(/[A-Z]\d+/g);
    return matches || [];
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
   * @param {object} attacker - {name, dice, critThreshold, fumbleThreshold}
   * @param {object} defender - {name, dice, critThreshold, fumbleThreshold}
   */
  startCombat(attacker, defender) {
    // N0: 연격 특성 적용 - 응수(방어자) 주사위 2개 감소, 하한 3
    let defenderDice = defender.dice;
    let defenderN0Bonus = 0;
    if ((defender.traits || []).includes('N0')) {
      defenderDice = Math.max(3, defenderDice - 2);
      defenderN0Bonus = 0;
    }
    let attackerN0Bonus = 0;
    if ((attacker.traits || []).includes('N0')) {
      attackerN0Bonus = 0;
    }
    this.combat = {
      attacker: {
        ...attacker,
        traits: attacker.traits || [],
        critCount: 0,
        fumbleCount: 0,
        h0Used: ((attacker.traits || []).includes('H00') || (attacker.traits || []).includes('H400')) ? true : false,
        h4Bonus: 0,
        baseCritThreshold: attacker.critThreshold,
        n0Bonus: attackerN0Bonus
      },
      defender: {
        ...defender,
        dice: defenderDice,
        traits: defender.traits || [],
        critCount: 0,
        fumbleCount: 0,
        h0Used: ((defender.traits || []).includes('H00') || (defender.traits || []).includes('H400')) ? true : false,
        h4Bonus: 0,
        baseCritThreshold: defender.critThreshold,
        n0Bonus: defenderN0Bonus
      }
    };
    this.round = 0;
    this.lastAttackerRoll = null;
    this.lastDefenderRoll = null;
    this.history = [];

    this._log(`전투 시작: ⚔️ ${attacker.name}(주사위${attacker.dice}, 대성공>=${attacker.critThreshold}, 대실패<=${attacker.fumbleThreshold}, 특성:${(attacker.traits||[]).join(',')}) vs 🛡️ ${defender.name}(주사위${defenderDice}, 대성공>=${defender.critThreshold}, 대실패<=${defender.fumbleThreshold}, 특성:${(defender.traits||[]).join(',')})`);
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
   * @param {boolean} manualMode - 수동 모드 여부 (H0 자동 처리 비활성화)
   * @returns {object} 라운드 결과 정보
   */
  processRoundResult(manualMode = false) {
    if (!this.combat || this.lastAttackerRoll === null || this.lastDefenderRoll === null) {
      this._log('⚠️ processRoundResult 호출 시 상태 부적절 → null 반환');
      this._log(`  combat=${!!this.combat}, atkRoll=${this.lastAttackerRoll}, defRoll=${this.lastDefenderRoll}`);
      return null;
    }

    // N0: 연격 특성 보너스 적용
    let atkVal = this.lastAttackerRoll;
    let defVal = this.lastDefenderRoll;
    if (this.combat.attacker.traits.includes('N0')) {
      atkVal += this.combat.attacker.n0Bonus || 0;
      this._log(`[N0] ${this.combat.attacker.name}: 연격 보너스 +${this.combat.attacker.n0Bonus || 0} 적용 → ${atkVal}`);
    }
    if (this.combat.defender.traits.includes('N0')) {
      defVal += this.combat.defender.n0Bonus || 0;
      this._log(`[N0] ${this.combat.defender.name}: 연격 보너스 +${this.combat.defender.n0Bonus || 0} 적용 → ${defVal}`);
    }
    const rules = this.config.rules;

    // 캐릭터별 대성공/대실패 수준 사용 (H4 보너스 적용 후 판정)
    const atkEffectiveCrit = this.combat.attacker.critThreshold;
    const defEffectiveCrit = this.combat.defender.critThreshold;
    const atkCrit = (atkVal >= atkEffectiveCrit);
    const atkFumble = (atkVal <= this.combat.attacker.fumbleThreshold);
    const defCrit = (defVal >= defEffectiveCrit);
    const defFumble = (defVal <= this.combat.defender.fumbleThreshold);

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

    // ── 결과별 효과음 선택 ──
    const isSpecial = atkCrit || atkFumble || defCrit || defFumble;
    const resultSound = isSpecial
      ? this._pickRandom(this.config.sounds.resultSpecialSounds || this.config.sounds.resultSpecialSound || ['챙챙4'])
      : this._pickRandom(this.config.sounds.resultNormalSounds || ['챙1', '챙2', '챙3']);

    // ── 특수 케이스 판정 ──

    // 1) 쌍방 대성공
    if (atkCrit && defCrit) {
      result.type = 'bothCrit';
      result.atkDiceChange = +rules.criticalBonus;
      result.defDiceChange = +rules.criticalBonus;
      this.combat.attacker.critCount++;
      this.combat.defender.critCount++;
      result.description = this._formatTemplate(this.config.templates.roundResultBothCrit, {
        atkValue: atkVal,
        defValue: defVal,
        sound: resultSound
      });
    }
    // 2) 쌍방 대실패
    else if (atkFumble && defFumble) {
      result.type = 'bothFumble';
      result.atkDiceChange = -(1 + rules.fumblePenalty);
      result.defDiceChange = -(1 + rules.fumblePenalty);
      this.combat.attacker.fumbleCount++;
      this.combat.defender.fumbleCount++;
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
      this.combat.attacker.critCount++;
      this.combat.defender.fumbleCount++;
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
      this.combat.defender.critCount++;
      this.combat.attacker.fumbleCount++;
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
      this.combat.attacker.critCount++;
      result.description = this._formatTemplate(this.config.templates.roundResultCrit, {
        name: this.combat.attacker.name,
        value: atkVal,
        sound: resultSound
      });
    }
    // 6) 방어자만 대성공
    else if (defCrit) {
      result.type = 'crit';
      result.winner = 'defender';
      result.defDiceChange = +rules.criticalBonus;
      result.atkDiceChange = -1;
      this.combat.defender.critCount++;
      result.description = this._formatTemplate(this.config.templates.roundResultCrit, {
        name: this.combat.defender.name,
        value: defVal,
        sound: resultSound
      });
    }
    // 7) 공격자만 대실패
    else if (atkFumble) {
      result.type = 'fumble';
      result.winner = 'defender';
      result.atkDiceChange = -(1 + rules.fumblePenalty);
      this.combat.attacker.fumbleCount++;
      result.description = this._formatTemplate(this.config.templates.roundResultFumble, {
        name: this.combat.attacker.name,
        value: atkVal,
        sound: resultSound
      });
    }
    // 8) 방어자만 대실패
    else if (defFumble) {
      result.type = 'fumble';
      result.winner = 'attacker';
      result.defDiceChange = -(1 + rules.fumblePenalty);
      this.combat.defender.fumbleCount++;
      result.description = this._formatTemplate(this.config.templates.roundResultFumble, {
        name: this.combat.defender.name,
        value: defVal,
        sound: resultSound
      });
    }
    // 9) 동점 (크리티컬/대실패 아님)
    else if (atkVal === defVal) {
      result.type = 'tie';
      result = this._handleTie(result, resultSound);
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
          winner: '⚔️ ' + this.combat.attacker.name,
          sound: resultSound
        });
      } else {
        result.winner = 'defender';
        result.atkDiceChange = -1;
        result.description = this._formatTemplate(this.config.templates.roundResultWin, {
          attacker: this.combat.attacker.name,
          defender: this.combat.defender.name,
          atkValue: atkVal,
          defValue: defVal,
          winner: '🛡️ ' + this.combat.defender.name,
          sound: resultSound
        });
      }
    }

    // 효과음 추가 (결과 메시지 끝에)
    if (resultSound && result.description) {
      result.description += ' @' + resultSound;
    }

    // 주사위 수 적용
    this.combat.attacker.dice = Math.max(0, this.combat.attacker.dice + result.atkDiceChange);
    this.combat.defender.dice = Math.max(0, this.combat.defender.dice + result.defDiceChange);

    // ── 특성 이벤트 추적 ──
    result.traitEvents = [];

    // ── N0 특성: 연격 ──
    this._applyN0('attacker', result.winner, result.traitEvents);
    this._applyN0('defender', result.winner, result.traitEvents);

    // ── H4 특성: 피로 새겨진 역사 ──
    this._applyH4('attacker', atkCrit, result.traitEvents, manualMode);
    this._applyH4('defender', defCrit, result.traitEvents, manualMode);

    // ── H0 특성: 인간 특성 (주사위 0 시 부활) ──
    this._applyH0('attacker', atkCrit, result.traitEvents, manualMode);
    this._applyH0('defender', defCrit, result.traitEvents, manualMode);
  /**
   * N0 특성: 연격
   * - 응수(방어자) 주사위 2개 감소(하한 3)는 startCombat에서 적용
   * - 승리 시 다음 판정에 +1 누적 보너스, 패배 시 0으로 초기화
   * - 보너스는 processRoundResult에서 판정값에 적용
   */

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
  _handleTie(result, resultSound) {
    const tieRule = this.config.rules.tieRule;
    switch (tieRule) {
      case 'reroll':
        result.description = this._formatTemplate(this.config.templates.roundResultTie, {
          atkValue: result.attackerRoll,
          defValue: result.defenderRoll,
          sound: resultSound
        });
        result.needsReroll = true;
        break;
      case 'bothLose':
        result.atkDiceChange = -1;
        result.defDiceChange = -1;
        result.description = this._formatTemplate(this.config.templates.roundResultTie, {
          atkValue: result.attackerRoll,
          defValue: result.defenderRoll,
          sound: resultSound
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
          winner: '⚔️ ' + this.combat.attacker.name + ' (동점 공격자 우위)',
          sound: resultSound
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
          winner: '🛡️ ' + this.combat.defender.name + ' (동점 방어자 우위)',
          sound: resultSound
        });
        break;
      default: // 'nothing'
        result.description = this._formatTemplate(this.config.templates.roundResultTie, {
          atkValue: result.attackerRoll,
          defValue: result.defenderRoll,
          sound: resultSound
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

  /**
   * H0/H00/H40/H400 특성 적용 (주사위 0 시 부활)
   * H0/H40: 처음부터 부활 가능, 크리티컬이면 재사용 가능.
   * H00/H400: 기본적으로 인간 특성 없음. 대성공 시 초기화되어 부활 가능.
   * H40/H400은 추가로 H4 초기화 시 발동 기능이 있음 (_applyH4에서 처리).
   */
  _applyH0(who, wasCrit, traitEvents, manualMode = false) {
    const fighter = this.combat[who];
    const hasH0 = fighter.traits.includes('H0') || fighter.traits.includes('H40');
    const hasH00 = fighter.traits.includes('H00') || fighter.traits.includes('H400');
    if (!hasH0 && !hasH00) return;

    const traitLabel = hasH00 ? (fighter.traits.includes('H400') ? 'H400' : 'H00')
                              : (fighter.traits.includes('H40') ? 'H40' : 'H0');

    // H40/H400이 이미 처리 대기 중이면 H0 중복 처리하지 않음
    if (traitEvents.some(te => te.who === who && te.event === 'h40_h0_available')) return;

    // 크리티컬 내면 H0/H00 초기화
    if (wasCrit && fighter.h0Used) {
      fighter.h0Used = false;
      this._log(`[${traitLabel}] ${fighter.name}: 크리티컬로 인간 특성 초기화`);
      traitEvents.push({ trait: traitLabel, who, name: fighter.name, event: 'reset' });
    }

    // 주사위 0 & 아직 미사용 → 부활 (수동 모드: 사용자 확인 대기)
    if (fighter.dice <= 0 && !fighter.h0Used) {
      if (manualMode) {
        this._log(`[${traitLabel}] ${fighter.name}: 인간 특성 발동 가능 (수동 모드 - 사용자 확인 대기)`);
        traitEvents.push({ trait: traitLabel, who, name: fighter.name, event: 'h0_available' });
      } else {
        fighter.dice = 1;
        fighter.h0Used = true;
        this._log(`[${traitLabel}] ${fighter.name}: 인간 특성 발동! 주사위 1개 부활`);
        traitEvents.push({ trait: traitLabel, who, name: fighter.name, event: 'resurrect' });
      }
    }
  }

  /**
   * H4/H40/H400 특성 적용 (피로 새겨진 역사)
   * 크리티컬 시 다음 굴림의 대성공 범위 +2 (즉, critThreshold -2).
   * 최대 +5까지 누적. 다음 굴림이 대성공이 아니면 초기화.
   *
   * H40/H400 추가 효과:
   *   H4 스택이 초기화될 때, 인간 특성이 사용 가능하면
   *   인간 특성을 발동하여 H4 스택을 유지한 채 추가 합 1회를 진행합니다.
   *   추가 합에서 대성공이면 H4 계속, 아니면 초기화.
   */
  _applyH4(who, wasCrit, traitEvents, manualMode = false) {
    const fighter = this.combat[who];
    const hasH4 = fighter.traits.includes('H4');
    const hasH40 = fighter.traits.includes('H40');
    const hasH400 = fighter.traits.includes('H400');
    if (!hasH4 && !hasH40 && !hasH400) return;

    if (wasCrit) {
      // 누적 보너스 +2, 최대 +5
      fighter.h4Bonus = Math.min(fighter.h4Bonus + 2, 5);
      fighter.critThreshold = fighter.baseCritThreshold - fighter.h4Bonus;
      this._log(`[H4] ${fighter.name}: 크리티컬! 대성공 범위 +${fighter.h4Bonus} (판정값 ${fighter.critThreshold}+)`);
      traitEvents.push({ trait: 'H4', who, name: fighter.name, event: 'stack', bonus: fighter.h4Bonus, threshold: fighter.critThreshold });
    } else {
      // 비크리 → 보너스 초기화
      if (fighter.h4Bonus > 0) {
        // H40/H400 상호작용: 인간 특성 발동 → H4 유지한 채 추가 합 1회
        if ((hasH40 || hasH400) && !fighter.h0Used) {
          const interactionTrait = hasH400 ? 'H400' : 'H40';

          if (manualMode) {
            // 수동 모드: 자동 발동 안함, 사용자 확인 대기 (H4 스택은 아직 유지)
            this._log(`[${interactionTrait}] ${fighter.name}: 인간 특성 발동 가능 (수동 모드 - H4 스택 유지 / 사용자 확인 대기)`);
            traitEvents.push({
              trait: interactionTrait, who, name: fighter.name,
              event: 'h40_h0_available', bonus: fighter.h4Bonus, threshold: fighter.critThreshold
            });
            return;
          }

          fighter.h0Used = true;
          this._log(`[${interactionTrait}] ${fighter.name}: 인간 특성 발동! H4 스택(+${fighter.h4Bonus}) 유지, 추가 합 진행`);
          traitEvents.push({
            trait: interactionTrait, who, name: fighter.name,
            event: 'h0_extra_round', bonus: fighter.h4Bonus, threshold: fighter.critThreshold
          });
          // H4 스택을 초기화하지 않음! 추가 합에서 판정
          return;
        }

        this._log(`[H4] ${fighter.name}: 비크리티컬로 보너스 초기화 (${fighter.h4Bonus} → 0)`);
        traitEvents.push({ trait: 'H4', who, name: fighter.name, event: 'reset', oldBonus: fighter.h4Bonus });
        fighter.h4Bonus = 0;
        fighter.critThreshold = fighter.baseCritThreshold;
      }
    }
  }

  // ── 수동 모드: H0 수동 적용 ──────────────────────────────

  /**
   * 수동 모드에서 사용자가 H0 발동을 확인했을 때 호출.
   * 주사위 0인 상태에서 dice=1로 부활시킵니다.
   */
  applyManualH0(who) {
    const fighter = this.combat?.[who];
    if (!fighter || fighter.dice > 0 || fighter.h0Used) return null;

    fighter.dice = 1;
    fighter.h0Used = true;

    const hasH00 = fighter.traits.includes('H00') || fighter.traits.includes('H400');
    const traitLabel = hasH00 ? (fighter.traits.includes('H400') ? 'H400' : 'H00')
                              : (fighter.traits.includes('H40') ? 'H40' : 'H0');

    this._log(`[${traitLabel}] ${fighter.name}: 수동 인간 특성 발동! 주사위 1개 부활`);
    return { trait: traitLabel, who, name: fighter.name, event: 'resurrect' };
  }

  /**
   * 수동 모드에서 H40/H400의 인간 특성 발동을 확인했을 때 호출.
   * H0를 소비하고 H4 스택 유지 → 추가 합 진행.
   */
  applyManualH40H0(who) {
    const fighter = this.combat?.[who];
    if (!fighter || fighter.h0Used) return null;

    fighter.h0Used = true;
    const hasH400 = fighter.traits.includes('H400');
    const traitLabel = hasH400 ? 'H400' : 'H40';

    this._log(`[${traitLabel}] ${fighter.name}: 수동 인간 특성 발동! H4 스택(+${fighter.h4Bonus}) 유지, 추가 합`);
    return {
      trait: traitLabel, who, name: fighter.name,
      event: 'h0_extra_round', bonus: fighter.h4Bonus, threshold: fighter.critThreshold
    };
  }

  /**
   * 수동 모드에서 H40/H400의 인간 특성 발동을 거부했을 때 호출.
   * H4 스택을 초기화합니다.
   */
  declineH40H0(who) {
    const fighter = this.combat?.[who];
    if (!fighter) return;

    const oldBonus = fighter.h4Bonus;
    fighter.h4Bonus = 0;
    fighter.critThreshold = fighter.baseCritThreshold;
    this._log(`[H4] ${fighter.name}: 인간 특성 미발동 → H4 보너스 초기화 (${oldBonus} → 0)`);
  }

  /**
   * 수동 모드에서 자유 H0 발동 (주사위 0이 아니어도 사용 가능).
   * dice += 1, h0Used = true.
   */
  activateH0Free(who) {
    const fighter = this.combat?.[who];
    if (!fighter || fighter.h0Used) return null;

    const hasH0Trait = fighter.traits.some(t => ['H0', 'H00', 'H40', 'H400'].includes(t));
    if (!hasH0Trait) return null;

    const prevDice = fighter.dice;
    fighter.dice += 1;
    fighter.h0Used = true;

    const hasH00 = fighter.traits.includes('H00') || fighter.traits.includes('H400');
    const traitLabel = hasH00 ? (fighter.traits.includes('H400') ? 'H400' : 'H00')
                              : (fighter.traits.includes('H40') ? 'H40' : 'H0');

    this._log(`[${traitLabel}] ${fighter.name}: 수동 인간 특성 자유 발동! 주사위 +1 (${prevDice} → ${fighter.dice})`);
    return { trait: traitLabel, who, name: fighter.name, event: 'resurrect' };
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
      return '《합 종료》 | 무승부 @' + this._pickRandom(this.config.sounds.victorySounds || this.config.sounds.victorySound || ['합']);
    }

    const winnerData = winner === 'attacker' ? this.combat.attacker : this.combat.defender;
    const winnerIcon = winner === 'attacker' ? '⚔️' : '🛡️';
    const sound = this._pickRandom(this.config.sounds.victorySounds || this.config.sounds.victorySound || ['합']);

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
    const sounds = this.config.sounds.roundHeaderSounds || [];
    const sound = sounds[Math.floor(Math.random() * sounds.length)] || '';
    return this._formatTemplate(this.config.templates.roundHeader, {
      round: this.round,
      attacker: this.combat.attacker.name,
      atkDice: this.combat.attacker.dice,
      defender: this.combat.defender.name,
      defDice: this.combat.defender.dice,
      sound: sound
    });
  }

  /** 공격자 굴림 메시지 생성 */
  getAttackerRollMessage() {
    if (!this.combat) return '';
    return this._formatTemplate(this.config.templates.attackerRoll, {
      attacker: this.combat.attacker.name
    });
  }

  /** 방어자 굴림 메시지 생성 */
  getDefenderRollMessage() {
    if (!this.combat) return '';
    return this._formatTemplate(this.config.templates.defenderRoll, {
      defender: this.combat.defender.name
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


    /**
     * N0 특성: 연격
     * - 응수(방어자) 주사위 2개 감소(하한 3)는 startCombat에서 적용
     * - 승리 시 다음 판정에 +1 누적 보너스, 패배 시 0으로 초기화
     * - 보너스는 processRoundResult에서 판정값에 적용
     */
    _applyN0(who, winner, traitEvents) {
      const fighter = this.combat[who];
      if (!fighter.traits.includes('N0')) return;
      if (!('n0Bonus' in fighter)) fighter.n0Bonus = 0;
      // 승리 시 +1 누적, 패배 시 0으로 초기화
      if (winner === who) {
        fighter.n0Bonus = (fighter.n0Bonus || 0) + 1;
        this._log(`[N0] ${fighter.name}: 연격 승리! 다음 판정 보너스 +${fighter.n0Bonus}`);
        traitEvents.push({ trait: 'N0', who, name: fighter.name, event: 'stack', bonus: fighter.n0Bonus });
      } else if (winner && winner !== who) {
        if (fighter.n0Bonus > 0) {
          this._log(`[N0] ${fighter.name}: 연격 패배, 보너스 초기화 (${fighter.n0Bonus} → 0)`);
          traitEvents.push({ trait: 'N0', who, name: fighter.name, event: 'reset', oldBonus: fighter.n0Bonus });
        }
        fighter.n0Bonus = 0;
      }
    }

  /** 배열에서 무작위 선택 (문자열 입력 시 그대로 반환) */
  _pickRandom(arr) {
    if (!arr) return '';
    if (typeof arr === 'string') return arr;
    if (arr.length === 0) return '';
    return arr[Math.floor(Math.random() * arr.length)];
  }

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
