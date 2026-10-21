export interface WaResult { ok: boolean; info: string }
/** Pengirim WhatsApp. TIDAK PERNAH melempar (I15: notifikasi gagal tidak menggagalkan transaksi); kegagalan dikembalikan sebagai `ok:false`. */
export interface WaSender { send(to: string, text: string): Promise<WaResult> }
