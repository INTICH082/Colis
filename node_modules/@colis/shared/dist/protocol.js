export var ClientOpCode;
(function (ClientOpCode) {
    ClientOpCode["JOIN_ROOM"] = "JOIN_ROOM";
    ClientOpCode["LEAVE_ROOM"] = "LEAVE_ROOM";
    ClientOpCode["PLAYER_INPUT"] = "PLAYER_INPUT";
    ClientOpCode["INTERACT_BOX_PICKUP"] = "INTERACT_BOX_PICKUP";
    ClientOpCode["INTERACT_BOX_DROP"] = "INTERACT_BOX_DROP";
    ClientOpCode["INTERACT_BOX_OPEN"] = "INTERACT_BOX_OPEN";
    ClientOpCode["INTERACT_PLACE_PRODUCT"] = "INTERACT_PLACE_PRODUCT";
    ClientOpCode["INTERACT_TAKE_PRODUCT"] = "INTERACT_TAKE_PRODUCT";
    ClientOpCode["ORDER_DELIVERY"] = "ORDER_DELIVERY";
})(ClientOpCode || (ClientOpCode = {}));
export var ServerOpCode;
(function (ServerOpCode) {
    ServerOpCode["INIT_ROOM"] = "INIT_ROOM";
    ServerOpCode["PLAYER_JOINED"] = "PLAYER_JOINED";
    ServerOpCode["PLAYER_LEFT"] = "PLAYER_LEFT";
    ServerOpCode["WORLD_TICK"] = "WORLD_TICK";
    ServerOpCode["BOX_STATE_CHANGED"] = "BOX_STATE_CHANGED";
    ServerOpCode["SHELF_STATE_CHANGED"] = "SHELF_STATE_CHANGED";
    ServerOpCode["STORE_ECONOMY_CHANGED"] = "STORE_ECONOMY_CHANGED";
    ServerOpCode["ACTION_REJECTED"] = "ACTION_REJECTED";
    ServerOpCode["NOTIFICATION"] = "NOTIFICATION";
})(ServerOpCode || (ServerOpCode = {}));
//# sourceMappingURL=protocol.js.map