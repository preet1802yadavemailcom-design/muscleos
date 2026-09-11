/**
 * Safe blob and file download utility.
 * Correctly handles:
 * - Direct Blob instances
 * - Enveloped Axios responses ({ data: Blob })
 * - Raw string data (e.g. CSV text)
 */
export function downloadBlob(blobOrData: any, defaultFilename: string): void {
  if (!blobOrData) return;

  let blob: Blob;
  if (blobOrData instanceof Blob) {
    blob = blobOrData;
  } else if (blobOrData?.data instanceof Blob) {
    blob = blobOrData.data;
  } else if (typeof blobOrData === 'string') {
    const isCsv = defaultFilename.endsWith('.csv');
    blob = new Blob([blobOrData], { type: isCsv ? 'text/csv;charset=utf-8;' : 'application/octet-stream' });
  } else {
    blob = new Blob([blobOrData]);
  }

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', defaultFilename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
