      * NORTHWIND PAY - EDI 820 PAYMENT ORDER, ERP EXPORT VARIANT (SYNTHETIC FIXTURE)
      * Same X12 820 meaning as 820.cpy, different byte contract:
      *   AMOUNT is COMP-3 packed decimal (7 bytes) instead of display + overpunch (13).
      * Fixed width: 88 bytes per record, records packed back to back with no line breaks
      * (an unblocked mainframe stream - this is why the copybook, not the newline, frames records).
      *
      * @framing fixed
      * @semantics amount=AMOUNT currency=CURRENCY valueDate=VALUE-DATE dateFormat=CCYYMMDD reference=REFERENCE transactionType=TXN-TYPE creditValue=C debitValue=D
      * @control typeField=REC-TYPE trailerValue=T countField=REC-COUNT totalField=AMOUNT currencyField=CURRENCY
      *
       01  PAYMENT-RECORD-PACKED.
           05  REC-TYPE            PIC X(1).
           05  ORIG-ID             PIC X(10).
           05  RECEIVER-ID         PIC X(10).
           05  TXN-TYPE            PIC X(2).
           05  AMOUNT              PIC S9(11)V99 COMP-3.
           05  CURRENCY            PIC X(3).
           05  VALUE-DATE          PIC 9(8).
           05  REFERENCE           PIC X(15).
           05  REC-COUNT           PIC 9(6).
           05  FILLER              PIC X(26).
