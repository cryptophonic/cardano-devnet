# Counter script

This directory contains a smart contract example for a "counter" script. The script has an integer value stored in the datum of the latest UTxO. The script succeeds if the UTxO is spent by a transaction that creates an output UTxO to the same address with a datum containing the integer plus one. To track state it uses an NFT token that is stored in the latest UTxO and be spent into the subsequent UTxO.

1. Compile the aiken smart contract

```
$ cd aiken; aiken build; cd ..
```

This should create a "plutus.json" file in the aiken directory. This contains the smart contract bytecode.

2. Ensure the devnet is running

In a separate window:

```
$ start-cardano-devnet -miep 5
```

3. Seed the state with a datum with a count of 0. This involves minting the state NFT first, then creating the locked funds.

```
$ node seed-state.mjs
```

4. Increment the contract state using any wallet you choose:

```
$ fund alice 100
$ node increment-state.mjs alice
```

If you look at the output utxo you can observe that the CBOR datum shows the counter has been incremented. The datum's hex CBOR value is of the form "d8799fXXff" where XX is the current count stored in the UTxO.




