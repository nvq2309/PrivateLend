pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

template RangeCheck(bits) {
  signal input in;
  component n2b = Num2Bits(bits);
  n2b.in <== in;
}

template RangeCheck64() {
  signal input in;
  component rc = RangeCheck(64);
  rc.in <== in;
}

template AssertLessEq(bits) {
  signal input a;
  signal input b;
  component le = LessEqThan(bits);
  le.in[0] <== a;
  le.in[1] <== b;
  le.out === 1;
}

template LtvCheck() {
  signal input borrow;
  signal input supply;

  component borrowRc = RangeCheck64();
  component supplyRc = RangeCheck64();
  borrowRc.in <== borrow;
  supplyRc.in <== supply;

  signal borrowScaled;
  signal supplyScaled;

  borrowScaled <== borrow * 10;
  supplyScaled <== supply * 7;

  component ltvOk = AssertLessEq(72);
  ltvOk.a <== borrowScaled;
  ltvOk.b <== supplyScaled;
}
