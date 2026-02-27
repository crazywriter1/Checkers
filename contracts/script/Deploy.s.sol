// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {CheckersScore} from "../src/CheckersScore.sol";

contract DeployCheckersScore is Script {
    function run() external returns (CheckersScore) {
        vm.startBroadcast();
        CheckersScore score = new CheckersScore();
        vm.stopBroadcast();
        return score;
    }
}
