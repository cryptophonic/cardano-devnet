# DEX script

This directory contains an example DEX script, where a single UTxO has some locked funds of Token A and Token B. These funds may be swapped at the current price using a constant-K bonding curve by any wallet that sends either Token A or Token B and receives the other token as an output.

1. Compile the plutus script

```
$ cd aiken; aiken build; cd ..
```

2. In a separate window, run the devnet:

```
$ start-cardano-devnet -miep 2
```

3. Fund an owner address for the initial liquidity, and two trading wallets, alice and bob. Each of these will be funded with ADA from the devnet faucet, then each wallet mints some Token A and Token B for trading.  This is all done by the "setup.sh" script

```
$ ./setup.sh
```

4. Choose a UTxO for the smart contract

Note the address for the smart contract in the setup script's output. There will be a line like:

```
Script address = addr_test1wzshat7eyz5ql249wzzyxrf7v0nfnz84v7dmgef2lc3rseqd0xsr2
```

Copy that address and issue the following command:

```
$ utxos addr_test1wzshat7eyz5ql249wzzyxrf7v0nfnz84v7dmgef2lc3rseqd0xsr2
                           TxHash                                 TxIx        Amount
--------------------------------------------------------------------------------------
08055cc6b0c1bccc97c22997d556c9661a1448a3a66e66247c6ca9cb7aab6208     0        1133530 lovelace + 10000 d441227553a0f1a965fee7d60a0f724b368dd1bddbc208730fccebcf.546f6b656e41 + 2500 d441227553a0f1a965fee7d60a0f724b368dd1bddbc208730fccebcf.546f6b656e42 + TxOutDatumInline BabbageEraOnwardsConway (HashableScriptData "\216y\159\NUL\255" (ScriptDataConstructor 0 [ScriptDataNumber 0]))
```

From that output, note the TxHash and TxIx fields.

6. Create a trade for alice or bob.

```
$ node swap.mjs alice AtoB 10 <TxHash>#<TxIx>
```

For example, using the output above, the command would be:

```
$ node swap.mjs alice AtoB 10 08055cc6b0c1bccc97c22997d556c9661a1448a3a66e66247c6ca9cb7aab6208#0
```

This swaps 10 Token A for the max amount of Token B allowed under the current bonding curve. Feel free to play around with AtoB, BtoA and different wallets and token amounts.
