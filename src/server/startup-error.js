import { ConfigurationError } from "./config.js";
// Never print arbitrary Error messages/stacks: they may contain environment values.
export function startupDiagnostic(error, stage = "startup") {
  if (error instanceof ConfigurationError)
    return {
      event: "STARTUP_FAILED",
      stage,
      code: error.code,
      message: error.message,
    };
  const storage = {
    EACCES:
      "DATA_DIR tidak dapat ditulis. Periksa izin direktori dan mount Railway Volume.",
    EPERM:
      "Operasi filesystem ditolak. Periksa permission Railway Volume untuk DATA_DIR.",
    EROFS:
      "DATA_DIR berada pada filesystem read-only. Gunakan volume yang dapat ditulis.",
    ENOSPC:
      "Ruang penyimpanan server/volume penuh. Tambahkan ruang atau bersihkan file sementara.",
    ENOTDIR:
      "DATA_DIR atau salah satu subdirektorinya ternyata berupa file. Perbaiki mount/path.",
    EADDRINUSE:
      "Port sudah dipakai proses lain. Hentikan proses duplikat; di Railway gunakan PORT bawaan.",
  };
  if (storage[error?.code])
    return {
      event: "STARTUP_FAILED",
      stage,
      code: error.code,
      message: storage[error.code],
    };
  if (["STORE_JSON_INVALID", "STORE_SCHEMA_INVALID"].includes(error?.code)) {
    const key = ["media.json", "history.json", "settings.json"].includes(
      error.storeKey,
    )
      ? error.storeKey
      : "metadata JSON";
    return {
      event: "STARTUP_FAILED",
      stage,
      code: error.code,
      message: `${key} tidak valid. Pulihkan dari backup atau perbaiki isinya. File tidak otomatis dihapus agar data tidak hilang.`,
    };
  }
  return {
    event: "STARTUP_FAILED",
    stage,
    code: "STARTUP_INTERNAL",
    message:
      "Startup gagal pada tahap ini. Periksa dependency Node.js dan akses DATA_DIR. Tidak ada secret yang dicetak.",
  };
}
