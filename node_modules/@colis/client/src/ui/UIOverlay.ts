import { NotificationPayload, PRODUCTS } from '@colis/shared';

export class UIOverlay {
  private elMoney: HTMLElement;
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

  private onOrderCallback?: (productId: string, quantity: number) => void;
  private onChangeRoomCallback?: (roomId: string) => void;

  constructor() {
    this.elMoney = document.getElementById('hud-money')!;
    this.elRoom = document.getElementById('hud-room')!;
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

    this.setupEventListeners();
    this.renderDeliveryProducts();
  }

  private setupEventListeners(): void {
    const btnOrder = document.getElementById('btn-order-delivery');
    const btnCloseModal = document.getElementById('modal-close-btn');
    const btnChangeRoom = document.getElementById('btn-change-room');

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
  }): void {
    this.onOrderCallback = callbacks.onOrder;
    this.onChangeRoomCallback = callbacks.onChangeRoom;
  }

  private renderDeliveryProducts(): void {
    this.elProductGrid.innerHTML = '';

    for (const [id, prod] of Object.entries(PRODUCTS)) {
      const card = document.createElement('div');
      card.className = 'product-card';

      const boxCost = (prod.cost * prod.boxCapacity).toFixed(2);

      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 14px; height: 14px; border-radius: 3px; background: ${prod.color};"></div>
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

  public updateMoney(amount: number): void {
    this.elMoney.textContent = `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  public updateRoomInfo(roomId: string, playerCount: number): void {
    this.elRoom.textContent = roomId;
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
}
