export const parseRangeSpec = (spec: string, cap = 80): number[] => {
    if (!spec) return [];
    const clean = spec.replace(/\s+/g, '');
    const match = clean.match(/^(\d+(?:\.\d+)?|\.\d+)-(\d+(?:\.\d+)?|\.\d+)(?::(.+))?$/);
    if (!match) throw new Error('Use min-max:step, for example 7-21:1.');
    let min = Number(match[1]), max = Number(match[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('Range limits must be finite numbers.');
    if (min > max) [min, max] = [max, min];
    const step = match[3] === undefined ? (Number.isInteger(min) && Number.isInteger(max) ? 1 : 0.5) : Number(match[3]);
    if (!Number.isFinite(step) || step <= 0) throw new Error('Range step must be a finite number greater than zero.');
    const out = [];
    if (Math.floor((max - min) / step + 1e-8) + 1 > cap) throw new Error(`Range exceeds ${cap} values. Use a larger step.`);
    for (let i = 0; i < cap; i++) {
        const v = min + i * step;
        if (v > max + 1e-9) break;
        out.push(Number(v.toFixed(8)));
    }
    return out;
};

export const exportToCSV = (objArray: any[], filename: string) => {
    if (!objArray || objArray.length === 0) {
        console.warn("CSV export cancelled: No data to export.");
        return;
    }
    const keys = Object.keys(objArray[0]);
    const header = keys.map(k => `"${k}"`).join(',');
    const lines = objArray.map(row =>
        keys.map(key => `"${String(row[key] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csv = [header, ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
