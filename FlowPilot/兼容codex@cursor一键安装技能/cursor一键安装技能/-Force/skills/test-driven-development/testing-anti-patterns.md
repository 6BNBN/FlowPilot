# Testing Anti-Patterns

Load this reference when writing or changing tests, adding mocks, or feeling tempted to add test-only behavior to production code.

## Core Rule
Test real behavior, not the testing scaffolding.

## Anti-Pattern 1: Testing Mock Existence
Bad:
```typescript
test('renders sidebar', () => {
  render(<Page />);
  expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
});
```

Better:
```typescript
test('renders sidebar navigation', () => {
  render(<Page />);
  expect(screen.getByRole('navigation')).toBeInTheDocument();
});
```

Ask before asserting on a mock:
- Am I testing actual user-visible behavior?
- Would this still be meaningful if the mock implementation changed?

## Anti-Pattern 2: Test-Only Methods In Production Code
If a method exists only so tests can clean up or inspect internals, it usually belongs in test utilities instead of production code.

## Anti-Pattern 3: Mocking Without Understanding The Dependency
Before mocking a dependency, understand:
- what contract the real dependency provides
- which behavior actually matters for the test
- whether a lighter integration-style test would be more truthful

## Quick Rule Of Thumb
- mock less
- verify behavior more
- avoid production code that exists only for tests