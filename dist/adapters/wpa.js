// wpa_cli renders non-ASCII SSID bytes as \xHH sequences.
export function decodeWpaSsid(value) {
    const bytes = [];
    for (let i = 0; i < value.length;) {
        if (value[i] === '\\' && value[i + 1] === 'x' && /^[0-9a-f]{2}$/i.test(value.slice(i + 2, i + 4))) {
            bytes.push(parseInt(value.slice(i + 2, i + 4), 16));
            i += 4;
        }
        else {
            const code = value.codePointAt(i);
            bytes.push(...Buffer.from(String.fromCodePoint(code)));
            i += code > 0xffff ? 2 : 1;
        }
    }
    return Buffer.from(bytes).toString('utf8');
}
export function validWpaSsid(value) {
    return !!value && Buffer.byteLength(value) <= 32 && !/[\x00-\x1f\x7f\ufffd]/.test(value);
}
//# sourceMappingURL=wpa.js.map