// Photo helpers: shrink camera photos so they store and send quickly.
async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    return img;
  }
}

function toJpeg(src, max, quality) {
  const w = src.width, h = src.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process photo'))), 'image/jpeg', quality));
}

// Returns a readable full image (for WhatsApp) and a small thumbnail (for lists).
export async function compress(file) {
  const src = await decode(file);
  const [blob, thumb] = await Promise.all([toJpeg(src, 1400, 0.78), toJpeg(src, 320, 0.7)]);
  src.close?.();
  return { blob, thumb };
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async blob => hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
export const sha256Text = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

export const blobToDataURL = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
export const dataURLToBlob = url => fetch(url).then(r => r.blob());
