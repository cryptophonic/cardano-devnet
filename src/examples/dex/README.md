# DEX script

This directory contains an example DEX script, where a single UTxO has some locked funds of Token A and Token B. These funds may be swapped at the current price using a constant-K bonding curve by any wallet that sends either Token A or Token B and receives the other token as an output.

1. Compile the plutus script

```
$ cd aiken; aiken build; cd ..
```

2. Fund an owner address for the initial liquidity, and two trading wallets, alice and bob. Each of these will be funded with ADA from the devnet faucet, then each wallet mints some Token A and Token B for trading.  This is all done by the "setup.sh" script

```
$ ./setup.sh
```

3. Create a trade for alice or bob.

```
$ node swap.mjs alice AtoB 10
```

This swaps 10 Token A for the max amount of Token B allowed under the current bonding curve. Feel free to play around with AtoB, BtoA and different wallets and token amounts.
