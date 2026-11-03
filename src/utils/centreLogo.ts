/** react-pdf accepts raster images, not SVG. Rasterise locally; no disk file. */
export async function pdfCompatibleLogo(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:image/svg+xml')) return dataUrl;
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Invalid SVG'));
    image.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  const ratio = Math.min(256 / (image.naturalWidth || 256), 256 / (image.naturalHeight || 256));
  const width = (image.naturalWidth || 256) * ratio;
  const height = (image.naturalHeight || 256) * ratio;
  context.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
  return canvas.toDataURL('image/png');
}
