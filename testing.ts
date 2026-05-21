import fs from "fs/promises";
import path from "path";

let fun = async () => {
  let red = await fs.readdir(path.join(process.cwd(), "data/snapshots"));
  console.log(red);
  let res = red.reduce((name, cur) => {
    if (name > cur) return name;
    return cur;
  }, "0");
  console.log(res);
};

fun();
