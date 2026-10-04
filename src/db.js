const DB_NAME = "promo-ledger";
const STORE = "promos";
let databasePromise;

export function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, {
          keyPath: "id",
        });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("brand", "brand");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Close other Promo Ledger tabs and try again."));
    });
  }
  return databasePromise;
}

function transaction(mode, operation) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        try {
          result = operation(store);
        } catch (error) {
          tx.abort();
          reject(error);
          return;
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () =>
          reject(
            tx.error || new Error("Could not save to the local database."),
          );
        tx.onabort = () =>
          reject(
            tx.error ||
              new Error("The local database operation was cancelled."),
          );
      }),
  );
}

export async function listPromos() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(STORE, "readonly")
      .objectStore(STORE)
      .getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function savePromo(promo) {
  return transaction("readwrite", (store) => store.put(promo));
}
export function deletePromo(id) {
  return transaction("readwrite", (store) => store.delete(id));
}
export function mergePromos(promos) {
  return transaction("readwrite", (store) => {
    promos.forEach((promo) => store.put(promo));
    return promos.length;
  });
}
