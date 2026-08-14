#!/usr/bin/env python3
import csv
import glob
import os
import sys
from collections import defaultdict

path = sys.argv[1] if len(sys.argv) > 1 else max(
    glob.glob(os.path.expanduser('~/Downloads/蝦皮蝦幣紀錄彙整_*.csv')),
    key=os.path.getmtime,
)
with open(path, encoding='utf-8-sig', newline='') as handle:
    rows = list(csv.DictReader(handle))

by_order = defaultdict(list)
by_title_amount = defaultdict(list)
for row in rows:
    order_sn = row.get('訂單編號', '')
    amount = abs(float(row['蝦幣數量']))
    if order_sn and order_sn != '-':
        by_order[order_sn].append(row)
    by_title_amount[(row['項目說明'], amount)].append(row)

other_source = [row for row in rows if row.get('分類') == '其他來源']
print(f'file={path}')
print(f'rows={len(rows)} other_source={len(other_source)} other_amount={sum(abs(float(row["蝦幣數量"])) for row in other_source):.2f}')
for row in sorted(other_source, key=lambda item: abs(float(item['蝦幣數量'])), reverse=True):
    order_sn = row.get('訂單編號', '')
    if not order_sn or order_sn == '-':
        continue
    print('\nSOURCE', row['蝦幣數量'], order_sn, row['項目說明'][:120])
    for counterpart in by_order[order_sn]:
        print('  ORDER', counterpart['變動類型'], counterpart['蝦幣數量'], counterpart['分類'], counterpart['項目說明'][:120])
    amount = abs(float(row['蝦幣數量']))
    for counterpart in by_title_amount[(row['項目說明'], amount)]:
        if counterpart is not row:
            print('  TITLE_AMOUNT', counterpart['變動類型'], counterpart['蝦幣數量'], counterpart['分類'], counterpart.get('訂單編號', ''))

refunds = [row for row in rows if row.get('分類') == '退款/沖正']
print(f'\nrefunds={len(refunds)} refund_amount={sum(abs(float(row["蝦幣數量"])) for row in refunds):.2f}')
for row in sorted(refunds, key=lambda item: abs(float(item['蝦幣數量'])), reverse=True):
    amount = abs(float(row['蝦幣數量']))
    order_sn = row.get('訂單編號', '')
    if row.get('分類規則') == 'source.matched-refund-order':
        counterparts = [
            item for item in by_order[order_sn]
            if item['變動類型'] == '使用/折抵' and abs(float(item['蝦幣數量'])) == amount
        ]
        match_type = 'order+amount'
    else:
        counterparts = [
            item for item in by_title_amount[(row['項目說明'], amount)]
            if item['變動類型'] == '使用/折抵'
        ]
        match_type = 'title+amount'
    print(
        'REFUND',
        f'{amount:.2f}',
        match_type,
        f'counterparts={len(counterparts)}',
        row.get('分類規則', ''),
    )
