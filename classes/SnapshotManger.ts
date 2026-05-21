import { writeFile } from "fs/promises";
import { readFileSync, readdirSync } from "fs";
import path, { parse } from "path";
import { string } from "zod";

interface Snapshotable<T> {
  getSnapshot(): T;
  loadSnapshot(snapshot: T): void;
}

class SnapshotManager {
  lastRedisStreamMessageId: string = "0";

  // return redis messge id at the time of snpahsot
  initialize(snapshotableClass: Snapshotable<any>): string {
    let toReturn = this.loadSnapshot(snapshotableClass);
    this.setupSavingSnapshot(snapshotableClass);
    return toReturn;
  }

  private setupSavingSnapshot(snapshotableClass: Snapshotable<any>) {
    setInterval(
      async () => {
        // make snapshot
        let snapshotObject = snapshotableClass.getSnapshot();
        let toSaveSnapshot = JSON.stringify(snapshotObject);

        try {
          await writeFile(
            path.join(
              process.cwd(),
              `data/snapshots/${this.lastRedisStreamMessageId}`,
            ),
            toSaveSnapshot,
          );
        } catch (error) {
          console.log(
            "saving snapshot to disk failed at redis message position ",
            this.lastRedisStreamMessageId,
          );
        }

        // save this to disk
      },
      5 * 60 * 1000,
    ); // every 5 mins
  }
  private loadSnapshot(snapshotableClass: Snapshotable<any>): string {
    // get max number redis messgae id snapshot

    let lastRedisMessageId = "0";

    let files = readdirSync(path.join(process.cwd(), "/data/snapshots"));

    if (files.length > 0) {
      let fileName = files.reduce((res, curVal) => {
        if (res < curVal) {
          res = curVal;
        }
        return res;
      }, "0");

      // get messgae id from file name
      lastRedisMessageId = fileName;
      lastRedisMessageId.replace(".json", "");

      // load snapshot from this file
      let fileData = readFileSync(
        path.join(process.cwd(), `data/snapshots/${fileName}`),
        "utf-8",
      );
      let parsedSnapshotData = JSON.parse(fileData);

      // maybe throw when unable to load snapshot so, we can replay from 0 in event stream
      snapshotableClass.loadSnapshot(parsedSnapshotData);
    }

    return lastRedisMessageId;
  }
}

export default SnapshotManager;
export type { Snapshotable };
