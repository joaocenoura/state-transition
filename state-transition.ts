import {
  allForks,
  CachedBeaconState,
  createCachedBeaconState,
} from "@chainsafe/lodestar-beacon-state-transition";
import { config as chainConfig } from "@chainsafe/lodestar-config/default";
import { createIBeaconConfig } from "@chainsafe/lodestar-config";
import { ssz, altair, phase0 } from "@chainsafe/lodestar-types";
import { TreeBacked } from "@chainsafe/ssz/lib/backings";
import * as fs from "fs";
import { init } from "@chainsafe/bls";

const ALTAIR_SLOT = 2375680;

interface Usecase {
  title: string;
  summary: string;
  startSlot: number;
  count: number;
}

const usecases = [
  {
    title: "USECASE #1 - Process phase0 only",
    summary: `Loads a phase0 state and reads only phase0 blocks.`,
    startSlot: 320,
    count: 64,
  },
  {
    title: "USECASE #2 - Process phase0 state + altair blocks",
    summary: `Loads phase0 state from last phase0 slot.
      The stateTransition **succeeds** as expected, it correctly upgrades
      state from phase0 to altair and continues to process altair forks
      until the end.`,
    startSlot: 2375679,
    count: 64,
  },
  {
    title:
      "USECASE #3 - Process altair state (after fork) + altair blocks",
    summary: `Loads state from the first altair slot.`,
    startSlot: 2375680,
    count: 64,
  },
  {
    title: "USECASE #4 - Process altair state + altair blocks",
    summary: `Same as previous usecase, but starts way after the fork.`,
    startSlot: 2880000,
    count: 64,
  },
];

init("blst-native").then(() => {
  usecases.forEach((u) => {
    try {
      runUsecase(u);
    } catch (err) {
      console.log("\nFailed to run usecase:");
      console.log(err);
    }
  });
});

// ============================================================================
//   USERCASE RUNNER
// ============================================================================
/**
 * Loads a BeaconState given a startSlot, then iterate the next count blocks
 * and move state forward, by using stateTransition function.
 * @param usecase params to run specific usecase
 */
function runUsecase(usecase: Usecase) {
  // 1) prepare usecase
  header(usecase);
  const { startSlot, count } = usecase;

  // 2) config for stateTransition function
  const opts = {
    verifyProposer: false,
    verifySignatures: false,
    verifyStateRoot: true,
  };

  const utils = createUtils();

  // 3) retrieve initial BeaconState from binary files
  let state = utils.readState(
    startSlot
  ) as CachedBeaconState<allForks.BeaconState>;

  // 4) keep a reference to the last block, to compare it's state root with current state
  let lastBlock = utils.readBlock(startSlot);

  // 5) iterate next N blocks and feed them to the stateTransition function
  for (let i = 1; i <= count; i++) {
    console.log();
    // 5.1) read block
    const slot = startSlot + i;
    const block = utils.readBlock(slot);

    // 5.2) skip stateTransition if we hit an empty block
    if (!block) {
      console.log("skipping empty block");
      continue;
    }

    // 5.3) otherwise, determine next state
    before(state, lastBlock);

    state = allForks.stateTransition(state, block, opts);

    after(state, block);
    lastBlock = block;
  }
}

// ============================================================================
//   UTILITIES (load test files helpers with ssz.phase0 or ssz.altair)
// ============================================================================
function createUtils() {
  // parse state and blocks with ssz library used bellow
  const utils = {
    phase0: {
      readState: (data: Buffer) =>
        ssz.phase0.BeaconState.createTreeBackedFromBytes(data),
      readBlock: (json: any) =>
        ssz.phase0.SignedBeaconBlock.createTreeBackedFromJson(json),
    },
    altair: {
      readState: (data: Buffer) =>
        ssz.altair.BeaconState.createTreeBackedFromBytes(data),
      readBlock: (json: any) =>
        ssz.altair.SignedBeaconBlock.createTreeBackedFromJson(json),
    },
  };
  return {
    readState: (
      slot: number
    ):
      | CachedBeaconState<phase0.BeaconState>
      | CachedBeaconState<altair.BeaconState> => {
      // load data file
      const path = `./test-data/state-${slot}.ssz`;
      console.log("readState -> readFile at", path);
      const data: Buffer = fs.readFileSync(path);

      // determine the right fork and read state
      let tree;
      if (slot < ALTAIR_SLOT) {
        tree = utils.phase0.readState(data);
      } else {
        tree = utils.altair.readState(data);
      }
      const config = createIBeaconConfig(
        chainConfig,
        tree.genesisValidatorsRoot
      );
      return createCachedBeaconState(config, tree as any);
    },
    readBlock: (
      slot: number
    ):
      | TreeBacked<phase0.SignedBeaconBlock>
      | TreeBacked<altair.SignedBeaconBlock>
      | undefined => {
      // load data file
      const path = `./test-data/block-${slot}.json`;
      console.log("readBlock -> readFile at", path);
      const payload = JSON.parse(fs.readFileSync(path, "utf-8"));
      const { version, data } = payload;

      // handle empty block
      if (payload["status"] === 404) {
        return undefined;
      }

      // determine the right fork and read block
      switch (version) {
        case "PHASE0": {
          return utils.phase0.readBlock(data);
        }
        case "ALTAIR":
          return utils.altair.readBlock(data);
      }
    },
  };
}

// ============================================================================
//   PRINT FUNCTIONS (not interesting, no logic)
// ============================================================================
function header({ title, summary, startSlot, count }: Usecase) {
  console.log(
    "\n\n==============================================================================="
  );
  console.log("  ", title);
  console.log(
    "==============================================================================="
  );
  console.log("Summary:", summary);
  console.log(`Slot range [${startSlot}, ${startSlot + count}] count=${count}`);
  console.log();
}

function before(
  state: CachedBeaconState<allForks.BeaconState>,
  block:
    | TreeBacked<phase0.SignedBeaconBlock>
    | TreeBacked<altair.SignedBeaconBlock>
    | undefined
) {
  console.log("before stateTransition");
  logStateRoots(state, block);
}
function after(
  state: CachedBeaconState<allForks.BeaconState>,
  block:
    | TreeBacked<phase0.SignedBeaconBlock>
    | TreeBacked<altair.SignedBeaconBlock>
) {
  console.log("after stateTransition");
  logStateRoots(state, block);
}
function logStateRoots(
  state: CachedBeaconState<allForks.BeaconState>,
  block:
    | TreeBacked<phase0.SignedBeaconBlock>
    | TreeBacked<altair.SignedBeaconBlock>
    | undefined
) {
  console.log(" |-- state.tree.root=", ssz.Root.toJson(state.tree.root));
  console.log(
    " `-- block.message.stateRoot=",
    block ? ssz.Root.toJson(block.message.stateRoot) : "empty block"
  );
}
