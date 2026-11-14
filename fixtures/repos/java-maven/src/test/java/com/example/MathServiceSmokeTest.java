package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

public class MathServiceSmokeTest {
    @Test
    void subtracts() {
        MathService svc = new MathService();
        assertEquals(3, svc.subtract(5, 2));
    }
}

