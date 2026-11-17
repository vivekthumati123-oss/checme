package com.acme.orders;

public enum OrderStatus {
    NEW,
    PAID,
    SHIPPED,
    CANCELLED;

    public boolean canTransitionTo(OrderStatus next) {
        switch (this) {
            case NEW:
                return next == PAID || next == CANCELLED;
            case PAID:
                return next == SHIPPED || next == CANCELLED;
            default:
                return false;
        }
    }
}
