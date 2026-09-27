import { linux } from './linux.js';
import { macos } from './macos.js';
import { failClosed } from '../util.js';
export function platform() {
    if (process.platform === 'darwin')
        return 'macos';
    if (process.platform === 'linux')
        return 'linux';
    return 'unsupported';
}
export function adapter() {
    const p = platform();
    if (p === 'linux')
        return { kind: 'linux', ...linux };
    if (p === 'macos')
        return { kind: 'macos', ...macos };
    failClosed(`Unsupported OS (${process.platform}) — openwifi v1 supports Ubuntu/Linux and macOS only`);
}
//# sourceMappingURL=index.js.map