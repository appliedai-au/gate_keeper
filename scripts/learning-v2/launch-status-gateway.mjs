// Owner-controlled opt-in entrypoint, not a second agent coordinator.
import { startTrueForgeStatusGateway } from './trueforge-status-gateway.mjs';
await startTrueForgeStatusGateway();
