// Intentionally separate executable from reusable testable verifier.
// No model SDK, gateway, or journal mutation beyond empty-root ownership.
import { verifyVolumeStartup } from './volume-start.mjs';
verifyVolumeStartup();
