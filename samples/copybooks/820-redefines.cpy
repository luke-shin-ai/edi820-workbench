      * NORTHWIND PAY - EDI 820 PAYMENT ORDER, BANK DIALECT (SYNTHETIC FIXTURE)
      * Fixed width: 101 bytes per record, line framing, ASCII transliteration.
      *
      * This is the copybook shape a bank actually sends: the one byte after REC-TYPE
      * is followed by a 100-byte area whose meaning depends on the record type.
      *   P  -> PAYMENT-DETAIL   (the payment itself)
      *   T  -> PAYMENT-TRAILER  (REC-COUNT and TOTAL-AMOUNT for the file)
      * The trailer is declared with REDEFINES because it occupies the same 100 bytes.
      *
      * A REDEFINES item is a layout, not a guess: each layout says, in the @view
      * directives below, which value of REC-TYPE selects it. A copybook that declares
      * REDEFINES without that rule is refused instead of read as whichever layout fits.
      *
      * @framing line
      * @semantics amount=AMOUNT currency=CURRENCY valueDate=VALUE-DATE dateFormat=CCYYMMDD reference=REFERENCE transactionType=TXN-TYPE creditValue=C debitValue=D
      * @control typeField=REC-TYPE trailerValue=T countField=REC-COUNT totalField=TOTAL-AMOUNT currencyField=TOTAL-CURRENCY
      * @view layout=PAYMENT-DETAIL typeField=REC-TYPE value=P
      * @view layout=PAYMENT-TRAILER typeField=REC-TYPE value=T
      *
       01  PAYMENT-RECORD.
           05  REC-TYPE            PIC X(1).
           05  RECORD-BODY.
               10  PAYMENT-DETAIL.
                   15  ORIG-ID         PIC X(10).
                   15  RECEIVER-ID     PIC X(10).
                   15  TXN-TYPE        PIC X(2).
                   15  AMOUNT          PIC S9(11)V99 SIGN TRAILING OVERPUNCH.
                   15  CURRENCY        PIC X(3).
                   15  VALUE-DATE      PIC 9(8).
                   15  REFERENCE       PIC X(15).
                   15  FILLER          PIC X(39).
               10  PAYMENT-TRAILER REDEFINES PAYMENT-DETAIL.
                   15  ORIG-ID-T       PIC X(10).
                   15  RECEIVER-ID-T   PIC X(10).
                   15  TOTAL-AMOUNT    PIC S9(11)V99 SIGN TRAILING OVERPUNCH.
                   15  TOTAL-CURRENCY  PIC X(3).
                   15  REC-COUNT       PIC 9(6).
                   15  FILLER          PIC X(58).
