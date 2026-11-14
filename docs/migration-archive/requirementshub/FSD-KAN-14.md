# 1. Purpose & Scope

This Functional Specification Document defines the migration requirements for the `legacy-orders-app` under Jira epic **KAN-14**.

The migration upgrades the application from **Java 8 and Spring Boot 1.5** to **Java 17 and Spring Boot 3.2**. Scope includes:

- Migrating shared utilities, customer services, reporting, and order services.
- Replacing `javax.*` namespaces with `jakarta.*` where applicable.
- Updating security, JAXB, Spring configuration, Hibernate, and Spring Data JPA implementations.
- Migrating modules in dependency order.
- Performing regression, integration, unit, static-analysis, and output-validation activities identified in Jira.
- Publishing updated shared artifacts for downstream modules.

The total estimated effort is **45 days**.

# 2. Epic Overview

| Field | Details |
|---|---|
| Jira Epic | KAN-14 |
| Title | Modernize legacy-orders-app |
| Project | AI Agent Development |
| Current platform | Java 8 and Spring Boot 1.5 |
| Target platform | Java 17 and Spring Boot 3.2 |
| Estimated effort | 45 days |
| Migration approach | Proceed in dependency order, starting with shared utilities and ending with the order-processing flow |
| Common migration requirements | Jakarta namespace migration, security configuration updates, and framework-specific remediation as applicable |

The planned dependency sequence is:

1. `common-utils`
2. `customer-service` and `reporting` after `common-utils`
3. `order-service` after `common-utils` and `customer-service`

# 3. Functional Requirements

## FR-001 — Migrate common-utils

**Jira key:** KAN-15  
**Title:** 1. Migrate common-utils  
**Estimated effort:** 4 days  
**Risk:** 3/10

### Description

Migrate the foundational `common-utils` module to Java 17 and the Spring Boot 3.2 parent POM. Deprecated `Date` and `Calendar` usage must be replaced with the `java.time` API. The updated shared artifact must be tested and published for use by dependent modules.

The module has low implementation complexity but a high blast radius because it is used throughout the application.

### Acceptance Criteria

**Proposed:**

- The Maven build targets Java 17 and uses the Spring Boot 3.2 parent POM.
- Deprecated `Date` and `Calendar` usage in scope is replaced with the `java.time` API.
- Existing unit tests complete without regressions.
- Static analysis completes without migration-related regressions.
- The updated shared artifact is published and available to dependent modules.

### Business Rules

- `common-utils` must be migrated before modules that depend on it.
- The updated shared artifact must be published for downstream consumption.
- Migration changes must not introduce regressions detectable by unit tests or static analysis.

### Dependencies

- No upstream module dependency.
- Downstream consumers include `customer-service`, `reporting`, and `order-service`.

### Open Questions

- What repository and version identifier should be used to publish the updated artifact?
- What unit-test and static-analysis success thresholds must be met?
- Which `Date` and `Calendar` behaviors, including time-zone behavior, must remain unchanged?
- **Proposed:** Define the required response when artifact publication fails, including whether downstream migration must be blocked.

---

## FR-002 — Migrate customer-service

**Jira key:** KAN-16  
**Title:** 2. Migrate customer-service  
**Estimated effort:** 10 days  
**Risk:** 5/10

### Description

Migrate `customer-service` to the target platform by replacing `javax.*` imports with `jakarta.*`, rewriting the security configuration using the Spring Security 6 component-based model, and consuming the new version of `common-utils`.

Authentication and profile APIs must be regression tested because the security configuration overhaul and namespace migration carry a moderate risk of authentication regressions.

### Acceptance Criteria

**Proposed:**

- Applicable `javax.*` imports are migrated to `jakarta.*`.
- Spring Security configuration uses the Spring Security 6 component-based model.
- `customer-service` depends on the migrated version of `common-utils`.
- Authentication API regression tests pass.
- Profile API regression tests pass.
- Existing authorization behavior is preserved unless an approved Jira requirement specifies otherwise.

### Business Rules

- Migration cannot proceed against the old `common-utils` dependency.
- Authentication and profile APIs require regression testing.
- Security configuration must use the Spring Security 6 component-based model.

### Dependencies

- Depends on `common-utils` / FR-001.
- `order-service` depends on the migrated `customer-service`.

### Open Questions

- Which authentication and profile API scenarios constitute the required regression suite?
- Which user roles, permissions, endpoints, and authentication mechanisms must be preserved?
- What version of the migrated `common-utils` artifact must be consumed?
- What are the required responses for authentication and authorization failures?
- **Proposed:** Define expected HTTP status codes and response bodies for unauthenticated, unauthorized, and invalid-profile requests.

---

## FR-003 — Migrate reporting

**Jira key:** KAN-17  
**Title:** 3. Migrate reporting  
**Estimated effort:** 8 days  
**Risk:** 6/10

### Description

Migrate the reporting module by adding a `jakarta.xml.bind` or standalone JAXB implementation dependency and refactoring marshalling and unmarshalling code to the new JAXB API.

The module must consume the migrated `common-utils` version. Nightly report output must be validated against baseline samples. The migration risk is elevated because removed JAXB APIs require dependency and code changes, while reporting jobs have limited test coverage.

### Acceptance Criteria

**Proposed:**

- A compatible `jakarta.xml.bind` or standalone JAXB implementation dependency is configured.
- Marshalling and unmarshalling code uses the new JAXB API.
- The reporting module depends on the migrated version of `common-utils`.
- Nightly reports are generated successfully.
- Generated report output matches the approved baseline samples according to defined comparison rules.

### Business Rules

- Reporting migration depends on completion of the `common-utils` migration.
- Nightly report output must be validated against baseline samples.
- JAXB marshalling and unmarshalling must use the new JAXB API.

### Dependencies

- Depends on `common-utils` / FR-001.

### Open Questions

- Which JAXB implementation and version must be used?
- Where are the approved baseline report samples stored?
- Which report fields must match exactly, and which dynamic fields may differ?
- What constitutes a successful nightly report run?
- What handling is required when marshalling, unmarshalling, or report generation fails?
- **Proposed:** Define an automated comparison method and permitted differences for dynamic report values such as timestamps.

---

## FR-004 — Migrate order-service

**Jira key:** KAN-18  
**Title:** 4. Migrate order-service  
**Estimated effort:** 23 days  
**Risk:** 8/10

### Description

Migrate the business-critical `order-service` module to the target platform. The work includes migrating `javax.*` imports to `jakarta.*`, converting custom XML bean configuration to Java or annotation-based Spring configuration, and upgrading Hibernate 4 queries to Hibernate 6 or Spring Data JPA syntax.

The service must consume the migrated versions of `common-utils` and `customer-service`. Extensive regression and integration testing is required for order creation and payment flows.

### Acceptance Criteria

**Proposed:**

- Applicable `javax.*` imports are migrated to `jakarta.*`.
- Custom XML-based bean configuration in scope is replaced with Java or annotation-based Spring configuration.
- Hibernate 4 queries are migrated to valid Hibernate 6 or Spring Data JPA syntax.
- `order-service` consumes the migrated versions of `common-utils` and `customer-service`.
- Regression tests for order creation pass.
- Integration tests for order creation and payment flows pass.
- Existing successful and unsuccessful order and payment outcomes are preserved unless an approved Jira requirement specifies otherwise.

### Business Rules

- `order-service` migration depends on completion of the `common-utils` and `customer-service` migrations.
- Custom XML-based bean configuration must be converted to Java or annotation-based Spring configuration.
- Hibernate 4 queries must be upgraded to Hibernate 6 or Spring Data JPA syntax.
- Order creation and payment flows require extensive regression and integration testing.

### Dependencies

- Depends on `common-utils` / FR-001.
- Depends on `customer-service` / FR-002.

### Open Questions

- Which order-creation and payment scenarios must be included in regression and integration testing?
- Which XML bean configuration files and Hibernate queries are in migration scope?
- What transactional behavior must be preserved during order creation and payment processing?
- Which payment integrations and test environments are required?
- What error responses and recovery behavior are required for failed orders, declined payments, timeouts, and downstream service failures?
- **Proposed:** Define expected state transitions and rollback behavior for every unsuccessful payment scenario.

# 4. Non-Functional Considerations

## Compatibility

- The application must target Java 17 and Spring Boot 3.2.
- Applicable modules must use Jakarta namespaces and framework-compatible dependencies.
- Security configuration must be compatible with Spring Security 6.
- Persistence queries must be compatible with Hibernate 6 or Spring Data JPA.
- JAXB functionality must use `jakarta.xml.bind` or a standalone JAXB implementation.

## Reliability and Regression Prevention

- `common-utils` requires unit tests and static analysis.
- `customer-service` requires regression testing of authentication and profile APIs.
- Reporting output requires validation against baseline samples.
- `order-service` requires extensive regression and integration testing of order creation and payment flows.

## Migration Risk

| Requirement | Risk | Jira rationale |
|---|---:|---|
| FR-001 | 3/10 | Foundational module with low complexity but high blast radius |
| FR-002 | 5/10 | Security overhaul and Jakarta migration may cause authentication regressions |
| FR-003 | 6/10 | JAXB removal requires dependency and code changes; reporting has limited test coverage |
| FR-004 | 8/10 | Largest and most complex module, with payment flow, XML configuration, outdated queries, and high business criticality |

## Proposed Considerations

- **Proposed:** Establish measurable pass criteria for each required test and static-analysis activity.
- **Proposed:** Validate migrated modules in dependency order before allowing downstream modules to consume them.
- **Proposed:** Preserve baseline security, report-generation, order-processing, and payment behavior unless changes are explicitly approved in Jira.
- **Proposed:** Define logging, monitoring, and failure-reporting requirements for authentication, reporting, order, payment, and artifact-publication failures.
- **Proposed:** Define performance and availability baselines to confirm that the platform migration does not introduce unacceptable degradation.

# 5. Assumptions

- The migration is performed in the dependency order documented in KAN-14.
- `common-utils` is migrated and published before dependent modules consume its updated artifact.
- `customer-service` is migrated before `order-service`.
- The total estimated effort remains 45 days, distributed as 4, 10, 8, and 23 days across the four requirements.
- **Proposed:** Existing functional behavior is treated as the migration baseline unless a separate Jira requirement authorizes a behavior change.
- **Proposed:** Existing tests and report samples are available to support the validation activities stated in Jira.

# 6. Open Questions

1. What artifact repository, versioning convention, and publication process apply to the migrated `common-utils` artifact?
2. What measurable pass criteria apply to unit tests, static analysis, regression tests, integration tests, and report comparisons?
3. Which authentication roles, permissions, endpoints, and failure responses must be preserved?
4. Which JAXB implementation and version should the reporting module use?
5. Where are the approved nightly-report baseline samples, and which differences are permitted?
6. Which order-creation and payment scenarios must be covered, including decline, timeout, rollback, and downstream-failure cases?
7. What error-handling, logging, monitoring, alerting, and recovery requirements apply to each module?
8. What performance, availability, and security baselines must be met after migration?
9. What acceptance authority or approval process determines that each module is ready for downstream consumption?
10. **Proposed:** Should each migrated module require formal sign-off before migration of its dependent modules begins?

## Traceability Matrix

| FR ID | Jira Key | Title |
|---|---|---|
| FR-001 | KAN-15 | 1. Migrate common-utils |
| FR-002 | KAN-16 | 2. Migrate customer-service |
| FR-003 | KAN-17 | 3. Migrate reporting |
| FR-004 | KAN-18 | 4. Migrate order-service |