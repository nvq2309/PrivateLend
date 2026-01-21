"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.airdrop = airdrop;
exports.createTestMint = createTestMint;
exports.mintTestTokens = mintTestTokens;
exports.derivePDAs = derivePDAs;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
function airdrop(connection_1, pubkey_1) {
    return __awaiter(this, arguments, void 0, function* (connection, pubkey, amount = 10) {
        const sig = yield connection.requestAirdrop(pubkey, amount * web3_js_1.LAMPORTS_PER_SOL);
        yield connection.confirmTransaction(sig);
    });
}
function createTestMint(connection_1, payer_1, authority_1) {
    return __awaiter(this, arguments, void 0, function* (connection, payer, authority, decimals = 9) {
        return (0, spl_token_1.createMint)(connection, payer, authority, null, decimals);
    });
}
function mintTestTokens(connection, payer, mint, destination, authority, amount) {
    return __awaiter(this, void 0, void 0, function* () {
        const ata = yield (0, spl_token_1.getOrCreateAssociatedTokenAccount)(connection, payer, mint, destination);
        yield (0, spl_token_1.mintTo)(connection, payer, mint, ata.address, authority, amount * web3_js_1.LAMPORTS_PER_SOL);
        return ata;
    });
}
function derivePDAs(programId, collateralMint, user) {
    const [vault, vaultBump] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("vault"), collateralMint.toBuffer()], programId);
    const [protectionPool] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("protection_pool"), vault.toBuffer()], programId);
    const [vaultCollateralAccount] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("vault_collateral"), vault.toBuffer()], programId);
    const [protectionReserveAccount] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("protection_reserve"), vault.toBuffer()], programId);
    const [userReceipt] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("user_receipt"), vault.toBuffer(), user.toBuffer()], programId);
    return {
        vault,
        vaultBump,
        protectionPool,
        vaultCollateralAccount,
        protectionReserveAccount,
        userReceipt,
    };
}
