import {
  GameEventState,
  NotificationPayload,
  PERSONAL_SKILLS,
  PRODUCTS,
  ShiftState,
  ShiftSummaryPayload,
  TEAM_UPGRADES,
} from '@colis/shared';

export class UIOverlay {
  private elMoney: HTMLElement;
  private elPersonalCash: HTMLElement;
  private elShiftBadge: HTMLElement;
  private elShiftPhaseText: HTMLElement;
  private elRoom: HTMLElement;
  private elPlayers: HTMLElement;
  private elHeldCard: HTMLElement;
  private elHeldName: HTMLElement;
  private elHeldCount: HTMLElement;
  private elHeldProgress: HTMLElement;
  private elPromptBox: HTMLElement;
  private elPromptText: HTMLElement;
  private elCrosshairBox: HTMLElement;
  private elNotifications: HTMLElement;
  private elModal: HTMLElement;
  private elProductGrid: HTMLElement;
  private elThrowCard: HTMLElement;
  private elThrowPct: HTMLElement;
  private elThrowFill: HTMLElement;
  private elStaminaCard: HTMLElement;
  private elStaminaPct: HTMLElement;
  private elStaminaFill: HTMLElement;

  // Dynamic Event Banner
  private elEventBanner: HTMLElement;
  private elEventTitle: HTMLElement;
  private elEventTimer: HTMLElement;
  private elEventDesc: HTMLElement;
  private elEventFill: HTMLElement;
  private elEventIcon: HTMLElement;

  // Breaker Repair Card
  private elBreakerCard: HTMLElement;
  private elBreakerPct: HTMLElement;
  private elBreakerFill: HTMLElement;

  // Upgrades & Skills Modal
  private elUpgradesModal: HTMLElement;
  private elUpgradesTeamGrid: HTMLElement;
  private elUpgradesPersonalGrid: HTMLElement;
  private elTabTeam: HTMLElement;
  private elTabPersonal: HTMLElement;

  // Shift Summary Modal
  private elSummaryModal: HTMLElement;
  private elSummaryTitle: HTMLElement;
  private elSummaryCustomers: HTMLElement;
  private elSummaryRevenue: HTMLElement;
  private elSummaryMonsters: HTMLElement;
  private elSummarySalary: HTMLElement;

  private onOrderCallback?: (productId: string, quantity: number) => void;
  private onChangeRoomCallback?: (roomId: string) => void;
  private onBuyTeamUpgradeCallback?: (upgradeId: string) => void;
  private onBuyPersonalSkillCallback?: (skillId: string) => void;
  private onSkipPhaseCallback?: () => void;

  private currentTeamUnlocks: string[] = [];
  private currentPersonalSkills: string[] = [];
  private currentStoreMoney: number = 1500;
  private currentPersonalCash: number = 50;

  constructor() {
    this.elMoney = document.getElementById('hud-money')!;
    this.elPersonalCash = document.getElementById('hud-personal-cash')!;
    this.elShiftBadge = document.getElementById('shift-badge')!;
    this.elShiftPhaseText = document.getElementById('shift-phase-text')!;
    this.elRoom = document.getElementById('hud-room') || document.createElement('div');
    this.elPlayers = document.getElementById('hud-players')!;
    this.elHeldCard = document.getElementById('held-box-card')!;
    this.elHeldName = document.getElementById('held-product-name')!;
    this.elHeldCount = document.getElementById('held-product-count')!;
    this.elHeldProgress = document.getElementById('held-progress-fill')!;
    this.elPromptBox = document.getElementById('interaction-prompt')!;
    this.elPromptText = document.getElementById('prompt-text')!;
    this.elCrosshairBox = document.getElementById('crosshair-box')!;
    this.elNotifications = document.getElementById('notifications')!;
    this.elModal = document.getElementById('delivery-modal')!;
    this.elProductGrid = document.getElementById('delivery-product-grid')!;
    this.elThrowCard = document.getElementById('throw-charge-card')!;
    this.elThrowPct = document.getElementById('throw-charge-pct')!;
    this.elThrowFill = document.getElementById('throw-charge-fill')!;
    this.elStaminaCard = document.getElementById('stamina-card')!;
    this.elStaminaPct = document.getElementById('stamina-pct')!;
    this.elStaminaFill = document.getElementById('stamina-fill')!;

    // Dynamic Event Banner
    this.elEventBanner = document.getElementById('event-banner')!;
    this.elEventTitle = document.getElementById('event-title')!;
    this.elEventTimer = document.getElementById('event-timer')!;
    this.elEventDesc = document.getElementById('event-desc')!;
    this.elEventFill = document.getElementById('event-bar-fill')!;
    this.elEventIcon = document.getElementById('event-icon')!;

    // Breaker Card
    this.elBreakerCard = document.getElementById('breaker-repair-card')!;
    this.elBreakerPct = document.getElementById('breaker-pct')!;
    this.elBreakerFill = document.querySelector('#breaker-repair-card .breaker-bar-fill') as HTMLElement;

    // Upgrades
    this.elUpgradesModal = document.getElementById('upgrades-modal')!;
    this.elUpgradesTeamGrid = document.getElementById('upgrades-team-container')!;
    this.elUpgradesPersonalGrid = document.getElementById('upgrades-personal-container')!;
    this.elTabTeam = document.getElementById('tab-btn-team')!;
    this.elTabPersonal = document.getElementById('tab-btn-personal')!;

    // Summary
    this.elSummaryModal = document.getElementById('shift-summary-modal')!;
    this.elSummaryTitle = document.getElementById('summary-title')!;
    this.elSummaryCustomers = document.getElementById('summary-customers')!;
    this.elSummaryRevenue = document.getElementById('summary-revenue')!;
    this.elSummaryMonsters = document.getElementById('summary-monsters')!;
    this.elSummarySalary = document.getElementById('summary-salary')!;

    this.setupEventListeners();
    this.renderDeliveryProducts();
  }

  private setupEventListeners(): void {
    const btnOrder = document.getElementById('btn-order-delivery');
    const btnCloseModal = document.getElementById('modal-close-btn');
    const btnChangeRoom = document.getElementById('btn-change-room');
    const btnSkills = document.getElementById('btn-skills-upgrades');
    const btnCloseUpgrades = document.getElementById('upgrades-close-btn');
    const btnSkipPhase = document.getElementById('btn-skip-phase');
    const btnCloseSummary = document.getElementById('btn-close-summary');

    btnOrder?.addEventListener('click', () => {
      this.elModal.style.display = 'flex';
    });

    btnCloseModal?.addEventListener('click', () => {
      this.elModal.style.display = 'none';
    });

    this.elModal.addEventListener('click', (e) => {
      if (e.target === this.elModal) {
        this.elModal.style.display = 'none';
      }
    });

    btnSkills?.addEventListener('click', () => {
      this.toggleUpgradesModal();
    });

    btnCloseUpgrades?.addEventListener('click', () => {
      this.toggleUpgradesModal(false);
    });

    this.elUpgradesModal.addEventListener('click', (e) => {
      if (e.target === this.elUpgradesModal) {
        this.toggleUpgradesModal(false);
      }
    });

    // Upgrades Tabs
    this.elTabTeam.addEventListener('click', () => {
      this.elTabTeam.style.background = 'var(--primary)';
      this.elTabPersonal.style.background = 'rgba(255,255,255,0.1)';
      this.elUpgradesTeamGrid.style.display = 'grid';
      this.elUpgradesPersonalGrid.style.display = 'none';
    });

    this.elTabPersonal.addEventListener('click', () => {
      this.elTabPersonal.style.background = 'var(--primary)';
      this.elTabTeam.style.background = 'rgba(255,255,255,0.1)';
      this.elUpgradesPersonalGrid.style.display = 'grid';
      this.elUpgradesTeamGrid.style.display = 'none';
    });

    btnSkipPhase?.addEventListener('click', () => {
      if (this.onSkipPhaseCallback) {
        this.onSkipPhaseCallback();
      }
    });

    btnCloseSummary?.addEventListener('click', () => {
      this.elSummaryModal.style.display = 'none';
    });

    btnChangeRoom?.addEventListener('click', () => {
      const room = prompt('Введите ID комнаты или название магазина:', 'store-coop-1');
      if (room && this.onChangeRoomCallback) {
        this.onChangeRoomCallback(room.trim());
      }
    });
  }

  public setCallbacks(callbacks: {
    onOrder: (productId: string, quantity: number) => void;
    onChangeRoom: (roomId: string) => void;
    onBuyTeamUpgrade?: (upgradeId: string) => void;
    onBuyPersonalSkill?: (skillId: string) => void;
    onSkipPhase?: () => void;
  }): void {
    this.onOrderCallback = callbacks.onOrder;
    this.onChangeRoomCallback = callbacks.onChangeRoom;
    this.onBuyTeamUpgradeCallback = callbacks.onBuyTeamUpgrade;
    this.onBuyPersonalSkillCallback = callbacks.onBuyPersonalSkill;
    this.onSkipPhaseCallback = callbacks.onSkipPhase;
  }

  public toggleUpgradesModal(open?: boolean): void {
    const shouldOpen = open !== undefined ? open : this.elUpgradesModal.style.display !== 'flex';
    this.elUpgradesModal.style.display = shouldOpen ? 'flex' : 'none';
    if (shouldOpen) {
      this.renderUpgrades();
    }
  }

  public isUpgradesModalOpen(): boolean {
    return this.elUpgradesModal.style.display === 'flex';
  }

  public updateMoney(amount: number): void {
    this.currentStoreMoney = amount;
    this.elMoney.textContent = `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (this.isUpgradesModalOpen()) this.renderUpgrades();
  }

  public updatePersonalCash(amount: number): void {
    this.currentPersonalCash = amount;
    this.elPersonalCash.textContent = `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (this.isUpgradesModalOpen()) this.renderUpgrades();
  }

  public updateShift(shift: ShiftState): void {
    this.elShiftBadge.textContent = `СМЕНА ${shift.shiftNumber}`;

    const minutes = Math.floor(shift.phaseTimeRemaining / 60);
    const seconds = Math.floor(shift.phaseTimeRemaining % 60);
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    if (shift.phase === 'DAY') {
      this.elShiftPhaseText.innerHTML = `☀️ ДЕНЬ (${timeStr})`;
      this.elShiftPhaseText.style.color = '#facc15';
    } else if (shift.phase === 'EVENING') {
      this.elShiftPhaseText.innerHTML = `🌆 ВЕЧЕР (${timeStr})`;
      this.elShiftPhaseText.style.color = '#f97316';
    } else {
      this.elShiftPhaseText.innerHTML = `🌑 НОЧЬ (${timeStr})`;
      this.elShiftPhaseText.style.color = '#ef4444';
    }
  }

  public showShiftSummary(summary: ShiftSummaryPayload): void {
    this.elSummaryTitle.textContent = `🏆 СМЕНА ${summary.shiftNumber} ЗАВЕРШЕНА!`;
    this.elSummaryCustomers.textContent = `${summary.customersServed} чел.`;
    this.elSummaryRevenue.textContent = `+$${summary.revenue.toFixed(2)}`;
    this.elSummaryMonsters.textContent = `${summary.monstersRepelled} шт.`;
    this.elSummarySalary.textContent = `+$${summary.salaryBonus.toFixed(2)}`;
    this.elSummaryModal.style.display = 'flex';
  }

  public setUpgradesData(teamUnlocks: string[], personalSkills: string[]): void {
    this.currentTeamUnlocks = teamUnlocks;
    this.currentPersonalSkills = personalSkills;
    if (this.isUpgradesModalOpen()) this.renderUpgrades();
  }

  private renderUpgrades(): void {
    // 1. Team Upgrades
    this.elUpgradesTeamGrid.innerHTML = '';
    for (const upgrade of Object.values(TEAM_UPGRADES)) {
      const isUnlocked = this.currentTeamUnlocks.includes(upgrade.id);
      const canAfford = this.currentStoreMoney >= upgrade.cost;

      const card = document.createElement('div');
      card.className = 'product-card';
      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 24px;">${upgrade.icon}</span>
          <span class="product-card-title">${upgrade.name}</span>
        </div>
        <p style="font-size: 0.76rem; color: var(--text-muted); min-height: 38px;">
          ${upgrade.description}
        </p>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
          <span class="product-card-price">$${upgrade.cost}</span>
          <button class="btn" style="padding: 4px 12px; font-size: 0.8rem; background: ${isUnlocked ? '#10b981' : canAfford ? 'var(--primary)' : '#475569'}; cursor: ${isUnlocked ? 'default' : 'pointer'};" ${isUnlocked ? 'disabled' : ''}>
            ${isUnlocked ? '✓ Куплено' : 'Купить'}
          </button>
        </div>
      `;

      const btn = card.querySelector('button');
      if (!isUnlocked && btn) {
        btn.addEventListener('click', () => {
          if (this.onBuyTeamUpgradeCallback) {
            this.onBuyTeamUpgradeCallback(upgrade.id);
          }
        });
      }

      this.elUpgradesTeamGrid.appendChild(card);
    }

    // 2. Personal Skills
    this.elUpgradesPersonalGrid.innerHTML = '';
    for (const skill of Object.values(PERSONAL_SKILLS)) {
      const isLearned = this.currentPersonalSkills.includes(skill.id);
      const canAfford = this.currentPersonalCash >= skill.cost;

      const card = document.createElement('div');
      card.className = 'product-card';
      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 24px;">${skill.icon}</span>
          <span class="product-card-title">${skill.name}</span>
        </div>
        <p style="font-size: 0.76rem; color: var(--text-muted); min-height: 38px;">
          ${skill.description}
        </p>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
          <span class="product-card-price" style="color: #38bdf8;">$${skill.cost}</span>
          <button class="btn" style="padding: 4px 12px; font-size: 0.8rem; background: ${isLearned ? '#10b981' : canAfford ? '#6366f1' : '#475569'}; cursor: ${isLearned ? 'default' : 'pointer'};" ${isLearned ? 'disabled' : ''}>
            ${isLearned ? '✓ Освоено' : 'Освоить'}
          </button>
        </div>
      `;

      const btn = card.querySelector('button');
      if (!isLearned && btn) {
        btn.addEventListener('click', () => {
          if (this.onBuyPersonalSkillCallback) {
            this.onBuyPersonalSkillCallback(skill.id);
          }
        });
      }

      this.elUpgradesPersonalGrid.appendChild(card);
    }
  }

  private renderDeliveryProducts(): void {
    this.elProductGrid.innerHTML = '';

    for (const [id, prod] of Object.entries(PRODUCTS)) {
      const card = document.createElement('div');
      card.className = 'product-card';

      const boxCost = (prod.cost * prod.boxCapacity).toFixed(2);

      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          ${prod.iconUrl ? `<img src="${prod.iconUrl}" style="width: 28px; height: 28px; object-fit: contain; image-rendering: pixelated; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3);" />` : `<div style="width: 16px; height: 16px; border-radius: 3px; background: ${prod.color};"></div>`}
          <span class="product-card-title">${prod.name}</span>
        </div>
        <div class="product-card-details">
          <span>В коробке: <b>${prod.boxCapacity} шт.</b></span>
          <span>Себестоимость: <b>$${boxCost} / кор.</b></span>
          <span>Цена на полке: <b>$${prod.price.toFixed(2)} / шт.</b></span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
          <span class="product-card-price">$${boxCost}</span>
          <button class="btn" style="padding: 4px 10px; font-size: 0.75rem;" data-product="${id}">
            + Заказать
          </button>
        </div>
      `;

      const orderBtn = card.querySelector('button');
      orderBtn?.addEventListener('click', () => {
        if (this.onOrderCallback) {
          this.onOrderCallback(id, 1);
        }
      });

      this.elProductGrid.appendChild(card);
    }
  }

  public updateRoomInfo(roomId: string, playerCount: number): void {
    if (this.elRoom) this.elRoom.textContent = roomId;
    this.elPlayers.textContent = `${playerCount} чел.`;
  }

  public setHeldBox(boxInfo: { name: string; remaining: number; max: number; isOpen: boolean } | null): void {
    if (!boxInfo) {
      this.elHeldCard.style.display = 'none';
      return;
    }

    this.elHeldCard.style.display = 'flex';
    this.elHeldName.textContent = `${boxInfo.name} ${boxInfo.isOpen ? '(Открыта)' : '(Запечатана - R)'}`;
    this.elHeldCount.textContent = `${boxInfo.remaining} / ${boxInfo.max} шт.`;

    const percent = Math.max(0, Math.min(100, (boxInfo.remaining / boxInfo.max) * 100));
    this.elHeldProgress.style.width = `${percent}%`;
  }

  public setInteractionPrompt(text: string | null, keyHint: string = 'E'): void {
    if (!text) {
      this.elPromptBox.style.display = 'none';
      this.elCrosshairBox.classList.remove('interactive');
      return;
    }

    this.elPromptBox.style.display = 'flex';
    this.elCrosshairBox.classList.add('interactive');
    const badge = this.elPromptBox.querySelector('.key-badge');
    if (badge) badge.textContent = keyHint;
    this.elPromptText.textContent = text;
  }

  public showNotification(notif: NotificationPayload): void {
    const item = document.createElement('div');
    item.className = `notification-item ${notif.type}`;
    item.textContent = notif.message;

    this.elNotifications.appendChild(item);

    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transition = 'opacity 0.4s';
      setTimeout(() => item.remove(), 400);
    }, 4000);
  }

  public setThrowCharge(chargeRatio: number | null): void {
    if (chargeRatio === null) {
      this.elThrowCard.style.display = 'none';
      return;
    }

    this.elThrowCard.style.display = 'flex';
    const percent = Math.round(Math.max(0, Math.min(1, chargeRatio)) * 100);
    this.elThrowPct.textContent = `${percent}%`;
    this.elThrowFill.style.width = `${percent}%`;
  }

  public setStamina(ratio: number): void {
    if (ratio >= 0.999) {
      this.elStaminaCard.style.display = 'none';
      return;
    }

    this.elStaminaCard.style.display = 'flex';
    const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    this.elStaminaPct.textContent = `${percent}%`;
    this.elStaminaFill.style.width = `${percent}%`;

    if (percent <= 15) {
      this.elStaminaFill.classList.add('depleted');
    } else {
      this.elStaminaFill.classList.remove('depleted');
    }
  }

  public updateEvent(event: GameEventState | null | undefined): void {
    if (!event || event.type === 'none') {
      this.elEventBanner.style.display = 'none';
      return;
    }

    this.elEventBanner.style.display = 'block';
    this.elEventIcon.textContent = event.icon || '⚠️';
    this.elEventTitle.textContent = event.title;

    let desc = event.description;
    if (event.type === 'sanitary_inspection' && event.currentCount !== undefined) {
      desc = `Уберите пустые коробки с пола! На полу сейчас: ${event.currentCount} шт.`;
    } else if (event.type === 'blackout' && event.progress !== undefined) {
      desc = `Свет отключен! Прогресс починки щитка: ${event.progress}%`;
    }
    this.elEventDesc.textContent = desc;

    const seconds = Math.max(0, Math.ceil(event.durationRemaining));
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    this.elEventTimer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    const fillRatio = Math.max(0, Math.min(1, event.durationRemaining / (event.totalDuration || 1)));
    this.elEventFill.style.width = `${fillRatio * 100}%`;
  }

  public updateBreakerUI(isNear: boolean, progress: number): void {
    if (!isNear) {
      this.elBreakerCard.style.display = 'none';
      return;
    }

    this.elBreakerCard.style.display = 'flex';
    const pct = Math.min(100, Math.max(0, Math.round(progress)));
    this.elBreakerPct.textContent = `${pct}%`;
    this.elBreakerFill.style.width = `${pct}%`;
  }
}
