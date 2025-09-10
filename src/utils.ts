export const parseRangeSpec = (spec: string, cap = 80): number[] => {
    if (!spec) return [];
    const clean = spec.replace(/\s+/g, '');
    const [range, stepStr] = clean.split(':');
    if (!range) return [];
    let [min, max] = range.split('-').map(Number);
    if (!isFinite(min) || !isFinite(max)) return [];
    if (min > max) [min, max] = [max, min];
    let step = stepStr ? Number(stepStr) : (Number.isInteger(min) && Number.isInteger(max) ? 1 : 0.5);
    if (!isFinite(step) || step <= 0) step = 1;
    const out = [];
    for (let v = min; v <= max + 1e-9 && out.length < cap; v += step) {
        // toFixed helps with floating point inaccuracies
        const precision = (String(step).split('.')[1] || '').length;
        out.push(Number(v.toFixed(precision)));
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