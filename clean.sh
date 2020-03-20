#!/bin/sh
x=1
while [ $x -le 4 ]
do
    node /main.js delete $1
    x=$(($x+1))
    print 'Hang tight ... still working on it ...'
done