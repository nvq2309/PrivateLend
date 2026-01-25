#!/bin/bash
set -e
cd circuits/veillend

echo "Compiling circuits..."
circom supply.circom --r1cs --wasm -o build/supply -l ../../node_modules
circom borrow.circom --r1cs --wasm -o build/borrow -l ../../node_modules
circom repay.circom --r1cs --wasm -o build/repay -l ../../node_modules
circom withdraw.circom --r1cs --wasm -o build/withdraw -l ../../node_modules

PTAU="build/ceremony_final.ptau"

for action in supply borrow repay withdraw; do
    echo "Setting up $action..."
    rm -f build/$action/setup_final.zkey build/$action/verification_key.json
    
    npx snarkjs groth16 setup build/$action/$action.r1cs $PTAU build/$action/setup_final.zkey
    
    npx snarkjs zkey export verificationkey build/$action/setup_final.zkey build/$action/verification_key.json
done

echo "Done."
