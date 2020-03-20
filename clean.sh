#!/bin/sh
x=1
while [ $x -le 4 ]
do
    node /main.js delete $1
    x=$(($x+1))
    println 'Hang tight ... still working on it ...'
done