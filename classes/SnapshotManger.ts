interface Snapshotable<T> {
  getSnapshot(): T;
  loadSnapshot(snapshot: T): void;
}

class SnapshotManager {
  classesToSnapshot: Snapshotable<any>[] = [];

  private setupSavingSnapshots() {
    setInterval(
      () => {
        this.classesToSnapshot.forEach((element) => {
          //
        });
      },
      5 * 60 * 1000,
    ); // every 5 mins
  }
  private loadSnapshots() {
    //
  }
  constructor(classesToSnapshot: Snapshotable<any>[]) {
    this.classesToSnapshot = classesToSnapshot;
    this.loadSnapshots();
    this.setupSavingSnapshots();
  }
}

export default SnapshotManager;
export type { Snapshotable };
