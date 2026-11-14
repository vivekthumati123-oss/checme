# JUnit 5 reference

- Files: `src/test/java/<package>/<ClassName>Test.java`.
- Use `@Test` and `@DisplayName("<behaviour>")`.
- Use `assertThrows(ErrorType.class, () -> ...)` for failures.
- Use Mockito `@Mock` and `@InjectMocks` for dependencies.
- Use `@ParameterizedTest` with `@CsvSource` for boundary tables.
