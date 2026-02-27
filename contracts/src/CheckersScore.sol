// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CheckersScore {
    mapping(address => uint256) public highScores;
    mapping(address => uint256) public gamesPlayed;
    mapping(address => uint256) public totalCaptures;

    event ScoreSubmitted(
        address indexed player,
        uint256 captured,
        uint256 timestamp
    );

    event NewHighScore(
        address indexed player,
        uint256 captured
    );

    function submitScore(uint256 captured) external {
        gamesPlayed[msg.sender]++;
        totalCaptures[msg.sender] += captured;

        if (captured > highScores[msg.sender]) {
            highScores[msg.sender] = captured;
            emit NewHighScore(msg.sender, captured);
        }

        emit ScoreSubmitted(msg.sender, captured, block.timestamp);
    }

    function getPlayerStats(address player)
        external
        view
        returns (uint256 highScore, uint256 games, uint256 captures)
    {
        return (highScores[player], gamesPlayed[player], totalCaptures[player]);
    }
}
