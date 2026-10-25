// Death certificate photo uploads, stored in R2 instead of a local disk.
// Ported from records.py's save_photo/resolve_photo. The client compresses
// before sending, so a photo stays small enough to travel inside a queued
// offline operation as a base64 data URL.
const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// PDFs are accepted but never required. A surveyor photographs each document —
// one tap, and the browser compresses it to a few hundred KB before it is queued.
// Asking them to combine documents into a PDF at the doorstep means leaving the
// app for a scanner app and finding the file again, and the result is BIGGER:
// a phone-scanned multi-page PDF is typically several MB and cannot be
// compressed client-side, so it sits whole in the offline outbox. The PDF path
// exists for a document the elector already has as one, such as a downloaded
// acknowledgement.
const DOC_EXT: Record<string, string> = { ...IMAGE_EXT, "application/pdf": "pdf" };

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
// A PDF arrives uncompressed, so it gets a tighter cap than a photo the client
// has already shrunk. Rejecting loudly beats a silent failure in the field.
const MAX_PDF_BYTES = 4 * 1024 * 1024;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Accepts a data: URL and returns the R2 object key to store on the record.
// `prefix` namespaces keys by dataset — "" for electors (legacy path shape),
// "asddo/" for the ASDD List, "draftsir/" for the Draft SIR 2026
// reverification rounds and "ph/" for a Public Hearing follow-up photo — so
// the datasets can't collide and fetchPhoto can tell them apart. `slot`
// (reverification only) namespaces further by which form field the photo
// belongs to: "<prefix><id>/<slot>/<uuid>.<ext>".
export async function savePhoto(
  bucket: R2Bucket,
  recordId: number,
  dataUrl: string,
  prefix = "",
  slot = "",
  allowPdf = false
): Promise<string> {
  const match = dataUrl.match(/^data:([\w/+.-]+);base64,([\s\S]*)$/);
  if (!match) throw new Error("Photo must be a base64 data URL");
  const mime = match[1].toLowerCase();
  const ext = allowPdf ? DOC_EXT[mime] : IMAGE_EXT[mime];
  if (!ext) {
    throw new Error(
      allowPdf
        ? "A document must be a JPEG, PNG or WebP image, or a PDF"
        : "Photo must be a JPEG, PNG or WebP image"
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(match[2]);
  } catch {
    throw new Error("Photo data is not valid base64");
  }
  const cap = mime === "application/pdf" ? MAX_PDF_BYTES : MAX_UPLOAD_BYTES;
  if (bytes.byteLength > cap) {
    throw new Error(
      mime === "application/pdf"
        ? "That PDF is too large. Photograph the pages instead — the app shrinks photos for you."
        : "Photo is too large"
    );
  }

  const slotSeg = slot && /^[a-z]+$/.test(slot) ? `${slot}/` : "";
  const key = `${prefix}${recordId}/${slotSeg}${crypto.randomUUID()}.${ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
  return key;
}

/**
 * Save the documents attached to one verification form and return their R2 keys.
 * Anything already stored (a plain key rather than a data: URL) is passed
 * through untouched, so re-saving a form does not duplicate its uploads.
 */
export async function saveFormDocs(
  bucket: R2Bucket,
  voterKey: string,
  docs: string[],
  max: number
): Promise<string[]> {
  const out: string[] = [];
  for (const d of docs.slice(0, max)) {
    if (!d.startsWith("data:")) {
      out.push(d); // already uploaded on an earlier save
      continue;
    }
    out.push(await savePhotoForKey(bucket, voterKey, d));
  }
  return out;
}

// Verification documents are keyed by the elector's EPIC, not a row id: the
// ok_* register can be rebuilt (ids shift when more data loads) but the EPIC
// does not, so a stored document survives a reload.
async function savePhotoForKey(bucket: R2Bucket, voterKey: string, dataUrl: string): Promise<string> {
  const safe = voterKey.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!safe) throw new Error("Missing EPIC for the document");
  return savePhoto(bucket, 0, dataUrl, `verify/${safe}/`, "", true);
}

export async function fetchPhoto(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  // A stored key is "<id>/<uuid>.<ext>" (electors) or, for the reverification
  // rounds, "asddo/<id>/<uuid>.<ext>" / "draftsir/<id>/<slot>/<uuid>.<ext>"
  // (slot = outcome|sir|voted|moved|jan), or "ph/<id>/<uuid>.<ext>" for a
  // Public Hearing follow-up photo. Verification documents add a fourth shape,
  // "verify/<EPIC>/0/<uuid>.<ext>", and are the only ones that may be a PDF.
  // Refuse anything else so this can't read arbitrary keys.
  const legacy = /^(asddo\/|draftsir\/|ph\/)?\d+\/([a-z]+\/)?[a-f0-9-]+\.(jpg|png|webp)$/;
  const verifyDoc = /^verify\/[A-Z0-9]+\/\d+\/[a-f0-9-]+\.(jpg|png|webp|pdf)$/;
  if (!legacy.test(key) && !verifyDoc.test(key)) return null;
  return bucket.get(key);
}
