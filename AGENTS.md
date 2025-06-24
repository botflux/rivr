# Agent Guidelines for Workflow Project

## Build & Test Commands
- **Build**: `npm run build` (TypeScript compilation with clean)
- **Type Check**: `npm run typecheck` (no emit, type checking only)
- **Test**: `npm test` (runs borp test runner on all packages)
- **Single Test**: `cd packages/<package> && npm test <file>.spec.ts`

## Project Structure
- Monorepo with workspaces in `packages/` (core, engine-mongodb, engine-rabbitmq, engine-redis, fastify)
- TypeScript with composite project references
- Each package has its own `package.json` and `tsconfig.json`

## Code Style
- **TypeScript**: Strict mode enabled, ES2023 target, CommonJS modules
- **Imports**: Use named imports, organize by external/internal
- **Types**: Explicit typing, use interfaces for objects, type aliases for unions
- **Naming**: camelCase for variables/functions, PascalCase for types/classes
- **Files**: kebab-case for files, `.spec.ts` for tests
- **Error Handling**: Use Result types or explicit error handling patterns
- **Testing**: Use borp test runner, descriptive test names

## Key Patterns
- Plugin-based architecture with dependency injection
- Workflow state management with storage abstraction
- Type-safe step definitions with context passing