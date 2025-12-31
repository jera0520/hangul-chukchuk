"""한글 척척 엔진 도우미(사이트판). 엔진 파일(hwpdoc.py)은 선생님 배포본과 같아야 해서 고치지 않고, 엔진 함수를 불러 쓴다.

    extra photos <문서.hwpx> <설명.json> -o <결과.hwpx>
        사진 칸이 없는 문서 끝에 '붙임 사진' 쪽을 붙인다. 표는 엔진이 개요의 [표]를 만들 때 쓰는 함수 그대로
        (검은 실선 표, 사진 칸은 4:3, 한 쪽을 넘으면 묶음마다 나눔).
        설명.json: 사진 차례대로 설명 글 목록(빈 글이면 설명 없음). 설명이 하나도 없으면 설명 줄 없이 사진만 넣는다.
    extra cover <문서.hwpx>
        제출 문구·날짜·서명란이 든 칸(법정 서식 첫 쪽의 '…제출합니다 / 년 월 일 / (서명 또는 인) / ○○장 귀하')마다
        '키<탭>줄 수<탭>줄1 / 줄2 / …'를 찍는다. 이 칸을 AI가 줄을 빼고 다시 쓰면 첨부 서류·서명란·귀하 줄이 사라지므로,
        앱은 줄 수가 같게 쓴 값만 넣고 아니면 원래대로 둔다.
"""
import argparse
import copy
import json
import re

from lxml import etree

import hwpdoc as H

TITLE = '붙임 사진'


def body_width(blocks):
    """쪽 본문 너비(HWPUNIT): 용지 너비 - 왼쪽·오른쪽·제본 여백. 찾지 못하면 0."""
    for b in blocks:
        for pp in b.iter(H.P('pagePr')):
            try:
                w = int(pp.get('height') if pp.get('landscape') == 'NARROWLY' else pp.get('width'))
                m = pp.find(H.P('margin'))
                if m is not None:
                    w -= sum(int(m.get(k, '0') or 0) for k in ('left', 'right', 'gutter'))
                return max(0, w)
            except (TypeError, ValueError):
                return 0
    return 0


def photos(path, caps, out_path):
    caps = [str(c or '').strip() for c in caps]
    if not caps:
        raise H.HwpError('넣을 사진이 없습니다.')
    doc = H.RefDoc(path)
    ids = H.IdState(doc.root)
    warns = []
    cols = 1 if len(caps) == 1 else 2
    with_caps = any(caps)
    rows = []
    for i in range(0, len(caps), cols):
        part = caps[i:i + cols]
        rows.append(['[사진]'] * len(part) + [''] * (cols - len(part)))
        if with_caps:
            rows.append(part + [''] * (cols - len(part)))
    # 엔진의 기본 표 너비(46000)가 쪽 본문보다 넓으면 본문 너비에 맞춘다(표 바깥 여백 몫을 뺀다)
    first = doc.blocks[0].el if doc.blocks else doc.root
    bw = body_width([first])
    width = min(46000, bw - 800) if bw > 20000 else 46000
    orig = H._col_widths
    H._col_widths = lambda r, c, w, ex: orig(r, c, width, ex)
    try:
        tbl_p, _ = H.make_plain_table(doc, rows, ids, warns)
    finally:
        H._col_widths = orig
    tbl_p.set('pageBreak', '0')
    tbl_p.set('columnBreak', '0')
    # 설명 줄도 사진 칸처럼 가운데 정렬·글머리표 없이
    for tbl in tbl_p.iter(H.P('tbl')):
        for tr in tbl.findall(H.P('tr')):
            if any(H.PHOTO_RE.match(H.tc_text(tc)) for tc in tr.findall(H.P('tc'))):
                continue
            for x in tr.iter(H.P('p')):
                x.set('paraPrIDRef', doc.hedit.photo_para(x.get('paraPrIDRef')))
    # 제목 줄: 표 문단과 같은 모양에서 표를 빼고 글자만, 새 쪽에서 시작
    head = copy.deepcopy(tbl_p)
    runs = H.para_runs(head)
    for r in runs[1:]:
        head.remove(r)
    run = runs[0]
    for c in list(run):
        run.remove(c)
    etree.SubElement(run, H.P('t')).text = TITLE
    H.strip_lineseg(head)
    head.set('pageBreak', '1')
    # 구역이 여럿이면 마지막 구역 끝에 붙인다
    last = doc.sections[-1]
    root = doc.root if last == doc.sec_name else doc.pkg.xml(last)
    blocks = [first, head, tbl_p]  # 첫 문단은 쪽 크기를 읽는 데만 쓴다
    H.split_photo_tables(blocks, 1, ids, warns, doc.hedit)
    H.keep_with_tables(blocks, 1, doc.hedit)
    for b in blocks[1:]:
        root.append(b)
    if root is not doc.root:
        doc.pkg.put_xml(last, root)
    doc.hedit.save()
    H.finish_package(doc.pkg, doc.sec_name, doc.root, None)
    doc.pkg.save(out_path)
    n = sum(1 for b in blocks[1:] for t in b.iter(H.P('tbl')) for tc in t.iter(H.P('tc'))
            if H.PHOTO_RE.match(H.tc_text(tc)))
    print('[사진 쪽] %s — 사진 자리 %d곳%s' % (out_path, n, ', 설명 줄 있음' if with_caps else ''))
    for w in warns:
        if '기본 모양' not in w:
            print('- 참고: ' + w)


COVER_RE = re.compile(r'\(\s*서명\s*또는\s*인\s*\)|귀하\s*$|년\s{2,}월\s{2,}일')


def cover(path):
    """제출 문구·날짜·서명란 칸: 글 있는 문단이 3개 이상이고, '(서명 또는 인)'·'…귀하'로 끝나는 줄·빈 날짜('년  월  일')가 든 칸.
    [(키, 글 있는 줄 목록(띄어쓰기는 하나로))] 문서 차례대로."""
    pkg = H.Package(path)
    sec = pkg.xml(pkg.section_names()[0])
    out = []
    for key, el, kind, _ in H._walk_slots(sec):
        if kind != 'cell':
            continue
        lines = [' '.join(H.para_text(p).split()) for p in H._tc_paras(el)]
        lines = [x for x in lines if x]
        if len(lines) >= 3 and any(COVER_RE.search(x) for x in lines):
            out.append((key, lines))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description='한글 척척 엔진 도우미')
    sp = ap.add_subparsers(dest='cmd')
    a = sp.add_parser('photos', help='문서 끝에 붙임 사진 쪽 붙이기')
    a.add_argument('hwpx')
    a.add_argument('caps')
    a.add_argument('-o', '--out', required=True)
    c = sp.add_parser('cover', help='제출 문구·날짜·서명란 칸 찾기')
    c.add_argument('hwpx')
    args = ap.parse_args(argv)
    try:
        if args.cmd == 'photos':
            with open(args.caps, encoding='utf-8-sig') as f:
                photos(args.hwpx, json.load(f), args.out)
        elif args.cmd == 'cover':
            for k, lines in cover(args.hwpx):
                print('%s\t%d\t%s' % (k, len(lines), ' / '.join(lines)))
        else:
            ap.print_help()
            return 1
    except H.HwpError as e:
        print('[안내] %s' % e)
        return 2
    except Exception as e:
        import traceback
        traceback.print_exc()
        print('[오류] 도우미가 처리하지 못했습니다(%s: %s).' % (type(e).__name__, e))
        return 3
    return 0


if __name__ == '__main__':
    import sys
    sys.exit(main())
