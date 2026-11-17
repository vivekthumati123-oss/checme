package com.acme.orders;

import java.util.List;
import java.util.Locale;
import javax.annotation.processing.Generated;

public class PriceCalculator {

    private double taxRate;

    // Has validation logic: must be a target (kind: constructor).
    public PriceCalculator(double taxRate) {
        if (taxRate < 0) {
            throw new IllegalArgumentException("taxRate must be >= 0");
        }
        this.taxRate = taxRate;
    }

    // Trivial getter and setter: must be skipped.
    public double getTaxRate() {
        return taxRate;
    }

    public void setTaxRate(double taxRate) {
        this.taxRate = taxRate;
    }

    public double bulkPrice(int quantity, double unitPrice) {
        if (quantity <= 0 || unitPrice < 0) {
            throw new IllegalArgumentException("invalid input");
        }
        double pct = 0;
        if (quantity >= 100) {
            pct = 20;
        } else if (quantity >= 50) {
            pct = 10;
        } else if (quantity >= 10) {
            pct = 5;
        }
        return round(quantity * unitPrice * (1 - pct / 100));
    }

    public double total(List<Double> linePrices) {
        if (linePrices == null) {
            throw new IllegalArgumentException("linePrices required");
        }
        double sum = 0;
        for (double price : linePrices) {
            sum += price;
        }
        return round(sum * (1 + taxRate));
    }

    public double applyCoupon(double total, String code) {
        switch (code.toUpperCase(Locale.ROOT)) {
            case "SAVE10":
                return round(total * 0.9);
            case "SAVE20":
                return round(total * 0.8);
            case "FREE":
                return 0.0;
            default:
                throw new IllegalArgumentException("unknown coupon: " + code);
        }
    }

    public static String formatMoney(double amount, String currency) {
        if (currency == null || currency.isBlank()) {
            throw new IllegalArgumentException("currency required");
        }
        return String.format(Locale.ROOT, "%s %.2f", currency.toUpperCase(Locale.ROOT), amount);
    }

    // Private: must be skipped.
    private static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    // Marked generated: must be skipped.
    @Generated("codegen")
    public String describe() {
        return "PriceCalculator[taxRate=" + taxRate + "]";
    }

    // main: must be skipped.
    public static void main(String[] args) {
        System.out.println(formatMoney(new PriceCalculator(0.2).bulkPrice(10, 5.0), "usd"));
    }
}
