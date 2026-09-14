import {
  BoxState,
  ClientMessage,
  ClientOpCode,
  InitRoomPayload,
  NotificationPayload,
  PlayerInputPayload,
  PlayerState,
  PlayerTacklePayload,
  RoomState,
  ServerMessage,
  ServerOpCode,
  InteractBoxDropPayload,
  ShelfState,
  Vector3D,
  WorldTickPayload,
  ShiftState,
  UpgradesChangedPayload,
  MonsterDefeatedPayload,
  ShiftSummaryPayload,
} from '@colis/shared';

export interface NetworkCallbacks {
  onInit: (data: InitRoomPayload) => void;
  onWorldTick: (tick: WorldTickPayload) => void;
  onPlayerJoined: (player: PlayerState) => void;
  onPlayerLeft: (playerId: string) => void;
  onBoxChanged: (box: BoxState) => void;
  onShelfChanged: (shelf: ShelfState) => void;
  onEconomyChanged: (data: { storeMoney: number; storeLevel: number }) => void;
  onNotification: (notif: NotificationPayload) => void;
  onConnectionStatus: (connected: boolean) => void;
  onPlayerTackled?: (data: PlayerTacklePayload) => void;
  onShiftChanged?: (shift: ShiftState) => void;
  onUpgradesChanged?: (upgrades: UpgradesChangedPayload) => void;
  onMonsterDefeated?: (data: MonsterDefeatedPayload) => void;
  onShiftSummary?: (data: ShiftSummaryPayload) => void;
}

export class NetworkClient {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private callbacks: NetworkCallbacks;
  private inputSequence: number = 0;
  private isConnected: boolean = false;
  private isIntentionallyClosed: boolean = false;
  private currentRoomId: string = 'store-main';
  private playerName: string = 'Работник';

  constructor(serverUrl: string, callbacks: NetworkCallbacks) {
    this.serverUrl = serverUrl;
    this.callbacks = callbacks;
  }

  public connect(roomId: string = 'store-main', playerName?: string): void {
    this.currentRoomId = roomId;
    if (playerName) this.playerName = playerName;
    this.isIntentionallyClosed = false;

    if (this.ws) {
      this.ws.close();
    }

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.callbacks.onConnectionStatus(true);
        console.log('[Network] Connected to Colis Game Server');

        // Join room
        this.send({
          op: ClientOpCode.JOIN_ROOM,
          data: {
            roomId: this.currentRoomId,
            playerName: this.playerName,
          },
        });
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          this.handleServerMessage(msg);
        } catch (err) {
          console.error('[Network] Parse error:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.callbacks.onConnectionStatus(false);
        if (this.isIntentionallyClosed) return;

        console.log('[Network] Disconnected. Reconnecting in 2s...');
        setTimeout(() => {
          if (!this.isConnected && !this.isIntentionallyClosed) {
            this.connect(this.currentRoomId, this.playerName);
          }
        }, 2000);
      };

      this.ws.onerror = (err) => {
        console.warn('[Network] WebSocket error:', err);
      };
    } catch (err) {
      console.error('[Network] Connection failed:', err);
    }
  }

  public disconnect(): void {
    this.isIntentionallyClosed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.op) {
      case ServerOpCode.INIT_ROOM:
        this.callbacks.onInit(msg.data);
        break;
      case ServerOpCode.WORLD_TICK:
        this.callbacks.onWorldTick(msg.data);
        break;
      case ServerOpCode.PLAYER_JOINED:
        this.callbacks.onPlayerJoined(msg.data);
        break;
      case ServerOpCode.PLAYER_LEFT:
        this.callbacks.onPlayerLeft(msg.data.playerId);
        break;
      case ServerOpCode.BOX_STATE_CHANGED:
        this.callbacks.onBoxChanged(msg.data);
        break;
      case ServerOpCode.SHELF_STATE_CHANGED:
        this.callbacks.onShelfChanged(msg.data);
        break;
      case ServerOpCode.STORE_ECONOMY_CHANGED:
        this.callbacks.onEconomyChanged(msg.data);
        break;
      case ServerOpCode.NOTIFICATION:
        this.callbacks.onNotification(msg.data);
        break;
      case ServerOpCode.ACTION_REJECTED:
        this.callbacks.onNotification({
          type: 'error',
          message: msg.data.reason,
        });
        break;
      case ServerOpCode.PLAYER_TACKLED:
        this.callbacks.onPlayerTackled?.(msg.data);
        break;
      case ServerOpCode.SHIFT_STATE_CHANGED:
        this.callbacks.onShiftChanged?.(msg.data);
        break;
      case ServerOpCode.UPGRADES_CHANGED:
        this.callbacks.onUpgradesChanged?.(msg.data);
        break;
      case ServerOpCode.MONSTER_DEFEATED:
        this.callbacks.onMonsterDefeated?.(msg.data);
        break;
      case ServerOpCode.SHIFT_SUMMARY:
        this.callbacks.onShiftSummary?.(msg.data);
        break;
    }
  }

  public sendBuyTeamUpgrade(upgradeId: string): void {
    this.send({
      op: ClientOpCode.BUY_TEAM_UPGRADE,
      data: { upgradeId },
    });
  }

  public sendBuyPersonalSkill(skillId: string): void {
    this.send({
      op: ClientOpCode.BUY_PERSONAL_SKILL,
      data: { skillId },
    });
  }

  public sendPlayerAttack(hitDirection: Vector3D): void {
    this.send({
      op: ClientOpCode.PLAYER_ATTACK,
      data: { hitDirection },
    });
  }

  public sendSkipPhase(): void {
    this.send({
      op: ClientOpCode.SKIP_PHASE,
    });
  }

  public sendPlayerTackle(victimId: string, impulseX: number, impulseZ: number, force: number = 1.0, duration: number = 3.0): void {
    this.send({
      op: ClientOpCode.PLAYER_TACKLE,
      data: {
        attackerId: '',
        victimId,
        impulseX,
        impulseZ,
        force,
        duration,
      },
    });
  }

  public sendInput(input: Omit<PlayerInputPayload, 'sequence'>): number {
    this.inputSequence++;
    this.send({
      op: ClientOpCode.PLAYER_INPUT,
      data: {
        ...input,
        sequence: this.inputSequence,
      },
    });
    return this.inputSequence;
  }

  public sendPickupBox(boxId: string, playerPosition?: Vector3D): void {
    this.send({
      op: ClientOpCode.INTERACT_BOX_PICKUP,
      data: { boxId, playerPosition },
    });
  }

  public sendDropBox(payload: InteractBoxDropPayload = {}): void {
    this.send({
      op: ClientOpCode.INTERACT_BOX_DROP,
      data: payload,
    });
  }

  public sendOpenBox(boxId?: string, playerPosition?: Vector3D): void {
    this.send({
      op: ClientOpCode.INTERACT_BOX_OPEN,
      data: { boxId, playerPosition },
    });
  }

  public sendPlaceProduct(shelfId: string, slotIndex: number, playerPosition?: Vector3D): void {
    this.send({
      op: ClientOpCode.INTERACT_PLACE_PRODUCT,
      data: { shelfId, slotIndex, playerPosition },
    });
  }

  public sendTakeProduct(shelfId: string, slotIndex: number, playerPosition?: Vector3D): void {
    this.send({
      op: ClientOpCode.INTERACT_TAKE_PRODUCT,
      data: { shelfId, slotIndex, playerPosition },
    });
  }

  public sendOrderDelivery(productId: string, quantity: number): void {
    this.send({
      op: ClientOpCode.ORDER_DELIVERY,
      data: { productId, quantity },
    });
  }

  private send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  public getConnected(): boolean {
    return this.isConnected;
  }
}
