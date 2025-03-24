#!/bin/sh

# Create wallet keys for actors
# echo "N" to answer prompt asking to overwrite if key already exists
echo "N" | key-gen owner > /dev/null
echo "N" | key-gen alice > /dev/null
echo "N" | key-gen bob > /dev/null

# Fund wallets (devnet must be running with monitor active (-m flag) for lucid to pull tx hash from mempool)
fund owner 10
fund alice 100
fund bob 100

node mint-trading-tokens.mjs owner 10000 2500
node mint-trading-tokens.mjs alice 1000 1000
node mint-trading-tokens.mjs bob 100 100

node add-liquidity.mjs owner 10000 2500
