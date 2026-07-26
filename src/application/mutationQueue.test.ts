import { MutationQueue } from "./mutationQueue";

describe("MutationQueue", () => {
  it("serializes saves so a slow earlier mutation cannot overwrite a newer one", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const queue = new MutationQueue();

    const first = queue.enqueue(async () => {
      order.push("first-start");
      await firstGate;
      order.push("first-end");
      return 1;
    });
    const second = queue.enqueue(async () => {
      order.push("second");
      return 2;
    });

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("continues after a rejected mutation", async () => {
    const queue = new MutationQueue();
    await expect(queue.enqueue(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    await expect(queue.enqueue(async () => "recovered")).resolves.toBe("recovered");
  });
});

