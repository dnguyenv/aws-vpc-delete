#!/bin/sh
x=1
while [ $x -le 4 ]
do
    node /main.js delete $1
    x=$(($x+1))
    if [ $x -le 4 ]
    then
        printf "Hang tight ... still working on it ...\n"
    fi
done

printf "The VPC has been deleted. Peace!\n"